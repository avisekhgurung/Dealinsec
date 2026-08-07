import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import passport from "passport";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runMigrations } from 'stripe-replit-sync';
import { getStripeSync } from './stripeClient';
import { WebhookHandlers } from './webhookHandlers';
import { setupGoogleAuth } from './googleAuth';
import { getSession } from './auth';
import { storage } from './storage';
import { registerToolPages, toolSitemapPaths } from './tools';

const app = express();

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.log('DATABASE_URL not found, skipping Stripe initialization');
    return;
  }

  // Skip Stripe in local development (requires Replit-specific tokens)
  if (!process.env.REPL_IDENTITY && !process.env.WEB_REPL_RENEWAL) {
    console.log('Replit tokens not found, skipping Stripe initialization (local dev mode)');
    return;
  }

  try {
    console.log('Initializing Stripe schema...');
    await runMigrations({ databaseUrl });
    console.log('Stripe schema ready');

    const stripeSync = await getStripeSync();

    console.log('Setting up managed webhook...');
    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
    const { webhook, uuid } = await stripeSync.findOrCreateManagedWebhook(
      `${webhookBaseUrl}/api/stripe/webhook`,
      {
        enabled_events: ['*'],
        description: 'Managed webhook for DealInSec Stripe sync',
      }
    );
    console.log(`Webhook configured: ${webhook.url} (UUID: ${uuid})`);

    console.log('Syncing Stripe data...');
    stripeSync.syncBackfill()
      .then(() => {
        console.log('Stripe data synced');
      })
      .catch((err: any) => {
        console.error('Error syncing Stripe data:', err);
      });
  } catch (error) {
    console.error('Failed to initialize Stripe:', error);
  }
}

// Canonical host + scheme. Google indexed three variants of this site
// (http://, https://apex, https://www) as separate pages, splitting ranking
// signal. Force one canonical origin with 301s so link equity consolidates.
// Behind Cloudflare + Render, the real scheme/host arrive in x-forwarded-*.
const CANONICAL_HOST = process.env.CANONICAL_HOST || "www.dealinsec.com";

function canonicalRedirect(req: Request, res: Response, next: NextFunction) {
  // Only enforce in production and only for the real domain — never touch
  // localhost, Render's *.onrender.com health checks, or preview hosts.
  if (process.env.NODE_ENV !== "production") return next();

  const forwardedHost = (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  const host = forwardedHost.split(":")[0].toLowerCase();
  const proto = ((req.headers["x-forwarded-proto"] as string) || req.protocol || "https")
    .split(",")[0].trim();

  // Apex or bare domain → canonical host; any http → https. Leave unrelated
  // hosts (onrender.com, etc.) alone so infra keeps working.
  const isOurDomain = host === "dealinsec.com" || host === "www.dealinsec.com";
  const needsHostFix = isOurDomain && host !== CANONICAL_HOST;
  const needsProtoFix = isOurDomain && proto !== "https";

  if (needsHostFix || needsProtoFix) {
    return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
  }
  return next();
}

(async () => {
  await initStripe();

  app.use(canonicalRedirect);

  // Liveness probe. Deliberately dependency-free (no DB, session or auth) and
  // registered first, so it returns instantly and an external uptime pinger can
  // keep the Render free-tier instance from spinning down (~50s cold start
  // otherwise, which hurts crawling + first-visit UX). See keep-warm workflow /
  // cron-job.org. Not linked publicly, so it stays out of the sitemap.
  app.get("/healthz", (_req, res) => {
    res.set("Cache-Control", "no-store").type("text/plain").send("ok");
  });

  // robots.txt — allow crawling, point at the sitemap. App/API routes are not
  // linked publicly, so we don't need to disallow them for SEO.
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send(
      `User-agent: *\nAllow: /\n\nSitemap: https://${CANONICAL_HOST}/sitemap.xml\n`,
    );
  });

  // sitemap.xml — the public, indexable pages only (the app itself is behind
  // auth and intentionally excluded).
  app.get("/sitemap.xml", (_req, res) => {
    const base = `https://${CANONICAL_HOST}`;
    const paths = ["/", "/pitch", "/terms", "/privacy", "/cookies", "/refund", ...toolSitemapPaths()];
    const urls = paths
      .map((p) => `  <url>\n    <loc>${base}${p}</loc>\n    <changefreq>weekly</changefreq>\n  </url>`)
      .join("\n");
    res
      .type("application/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });

  app.post(
    '/api/stripe/webhook/:uuid',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const signature = req.headers['stripe-signature'];

      if (!signature) {
        return res.status(400).json({ error: 'Missing stripe-signature' });
      }

      try {
        const sig = Array.isArray(signature) ? signature[0] : signature;

        if (!Buffer.isBuffer(req.body)) {
          console.error('STRIPE WEBHOOK ERROR: req.body is not a Buffer');
          return res.status(500).json({ error: 'Webhook processing error' });
        }

        const { uuid } = req.params;
        await WebhookHandlers.processWebhook(req.body as Buffer, sig, uuid);

        res.status(200).json({ received: true });
      } catch (error: any) {
        console.error('Webhook error:', error.message);
        res.status(400).json({ error: 'Webhook processing error' });
      }
    }
  );

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false }));

  // Session must come before passport
  app.use(getSession());

  // Google OAuth
  setupGoogleAuth();
  app.use(passport.initialize());
  app.use(passport.session());

  app.get("/api/auth/google", (req: any, res, next) => {
    passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
  });
  app.get(
    "/api/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/?error=google_auth_failed" }),
    async (req: any, res) => {
      if (req.user) {
        (req.session as any).userId = req.user.id;
      }
      res.redirect("/");
    }
  );

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }

        log(logLine);
      }
    });

    next();
  });

  // Serve uploaded files (signatures, proofs, etc.)
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  const httpServer = await registerRoutes(app);

  // Public server-rendered SEO/tool pages — MUST be registered before the SPA
  // catch-all (serveStatic / setupVite) so /tools/* returns real crawlable HTML
  // instead of the SPA shell.
  registerToolPages(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  const isProduction = process.env.NODE_ENV === "production";
  const host = isProduction ? "0.0.0.0" : "127.0.0.1";
  const listenOptions: any = { port, host };

  httpServer.listen(
    listenOptions,
    () => {
      log(`serving on ${host}:${port}`);
      log(`PayU configured: KEY=${!!process.env.PAYU_MERCHANT_KEY} SALT=${!!process.env.PAYU_SALT}`);
    },
  );
})();
