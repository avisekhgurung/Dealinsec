import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import passport from "passport";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { createServer } from "http";
import { setupGoogleAuth } from './googleAuth';
import { getSession } from './auth';
import { storage } from './storage';
import { registerToolPages, toolSitemapPaths } from './tools';
import { registerBlogPages, blogSitemapPaths } from './blog';
import { registerCategoryPages, categorySitemapPaths } from './category-pages';
import { registerComparisonPages, comparisonSitemapPaths } from './comparison-pages';
import { registerLegacyRedirects } from './legacy-redirects';
// The ledger key only, from a module with no side effects. NEVER import
// script/migrate-money-minor-units.ts here: that bundles its CLI into the server.
import { MONEY_MINOR_UNITS_KEY } from '@shared/migration-keys';

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
    // Entries are either a bare path or { loc, lastmod } — blog posts carry a
    // real last-modified date; a date that is invented (e.g. "today") would
    // teach Google to distrust the field, so tools/category pages omit it.
    const entries: (string | { loc: string; lastmod?: string })[] = [
      "/", "/pitch", "/terms", "/privacy", "/cookies", "/refund",
      ...categorySitemapPaths(), ...comparisonSitemapPaths(), ...toolSitemapPaths(), ...blogSitemapPaths(),
    ];
    const urls = entries
      .map((e) => (typeof e === "string" ? { loc: e } : e))
      .map(
        ({ loc, lastmod }) =>
          `  <url>\n    <loc>${base}${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n    <changefreq>weekly</changefreq>\n  </url>`,
      )
      .join("\n");
    res
      .type("application/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });

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
      // New Google signups carry a marker so the client fires the GA4
      // sign_up conversion (Google was the untracked signup path).
      res.redirect(req.user?.isNewSignup ? "/?signup=google" : "/");
    }
  );

  // Keys whose values must never reach a log line. Response bodies routinely
  // carry customer PII (names, emails, phones, PAN/GST, bank details, signature
  // URLs, tokens); Render retains stdout, so logging them verbatim would create
  // a second, unprotected copy of customer data. Matched case-insensitively on
  // a normalised key so panNumber / pan_number / PAN all hit.
  const SENSITIVE_KEY = /(password|token|secret|otp|signature|apikey|authorization|cookie|session|pan|gst|aadhaar|account|ifsc|upi|email|phone|mobile|address|dob)/i;
  const MAX_LOG_CHARS = 400;

  function redact(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) return value;
    if (depth > 4) return "[deep]";
    if (Array.isArray(value)) {
      return value.length > 5
        ? [...value.slice(0, 5).map((v) => redact(v, depth + 1)), `…+${value.length - 5} more`]
        : value.map((v) => redact(v, depth + 1));
    }
    if (typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEY.test(k.replace(/[_\-\s]/g, "")) ? "[redacted]" : redact(v, depth + 1);
      }
      return out;
    }
    if (typeof value === "string" && value.length > 120) return `${value.slice(0, 120)}…`;
    return value;
  }

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
        // Only failures carry a (redacted) body — success bodies are pure
        // customer data and add nothing a status code doesn't already say.
        if (capturedJsonResponse && res.statusCode >= 400) {
          let body: string;
          try {
            body = JSON.stringify(redact(capturedJsonResponse));
          } catch {
            body = "[unserialisable]";
          }
          if (body.length > MAX_LOG_CHARS) body = `${body.slice(0, MAX_LOG_CHARS)}…`;
          logLine += ` :: ${body}`;
        }

        log(logLine);
      }
    });

    next();
  });

  // Serve legacy uploaded files (signatures, payment proofs). New uploads go to
  // ImageKit; this path only exists for pre-ImageKit files. These are customer
  // documents, so require a logged-in session — an unguessable filename is not
  // an access control.
  app.use(
    "/uploads",
    (req, res, next) => {
      if (req.isAuthenticated?.()) return next();
      res.status(401).json({ error: "Authentication required" });
    },
    express.static(path.join(process.cwd(), "uploads")),
  );

  // Boot migration: brand_invoices.paid_at. Idempotent and additive, so it is
  // safe to run on every start. Done here rather than as a pre-push script
  // because the founder's network sometimes cannot reach the database at all —
  // the server always can, and the column must exist before the new code
  // serves its first request. Failure is logged loudly but never blocks boot.
  try {
    await db.execute(sql`ALTER TABLE brand_invoices ADD COLUMN IF NOT EXISTS paid_at timestamp`);
    log("boot migration: brand_invoices.paid_at ready");
  } catch (err) {
    console.error("BOOT MIGRATION FAILED (paid_at) — mark-paid will error until this runs:", err);
  }

  // Money + locale schema GATE — the server never migrates on boot.
  //
  // Dev and production share ONE Neon database (see .env), and every local
  // `npm run dev` boots this file. A boot-time migration therefore meant that
  // anyone starting a dev server without overriding DATABASE_URL would silently
  // multiply every production amount by 100. It also opened a deploy window
  // where the previous instance, still serving, read paise as rupees.
  //
  // So the migration is a deliberate, one-time operator step, run while the
  // live instance is stopped:
  //     npx tsx --env-file=.env script/migrate-money-minor-units.ts --apply
  // and boot only VERIFIES it happened. Fail closed: serving rupee-scaled rows
  // through minor-unit code shows every amount at 1/100th and, worse, writes
  // real paise into rupee rows that nobody can later tell apart. A refused boot
  // is recoverable; a mixed-unit money table is not.
  try {
    // Every column this build SELECTs that the migration adds. Checking only
    // users.country let through a database whose ledger key was claimed by an
    // earlier revision of the script, before it added the issued-currency
    // columns: the gate passed, then every contract and invoice read was a 500.
    // Read-only — information_schema, never DDL.
    const requiredColumns: readonly (readonly [table: string, column: string])[] = [
      ...["users", "organizations"].flatMap((table) =>
        ["country", "currency", "locale", "timezone"].map((column) => [table, column] as const)),
      ["contracts", "currency"],
      ["brand_invoices", "currency"],
    ];
    // Scoped to current_schema(), the schema the migration's DDL writes into
    // (its statements are unqualified). Without it a same-named table in any
    // other schema that happened to have a `currency` column satisfied the gate.
    const presentCols = await db.execute(sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ('users', 'organizations', 'contracts', 'brand_invoices')
        AND column_name IN ('country', 'currency', 'locale', 'timezone')`);
    const present = new Set(
      (presentCols.rows ?? []).map((r: any) => `${r.table_name}.${r.column_name}`),
    );
    const missingColumns = requiredColumns
      .map(([table, column]) => `${table}.${column}`)
      .filter((name) => !present.has(name));
    // Unqualified, like the migration's CREATE TABLE and the SELECT below, so
    // all three resolve the ledger through the same search_path. A hardcoded
    // 'public.' could find a different table than the one the SELECT reads.
    const ledger = await db.execute(sql`
      SELECT to_regclass('app_migrations') IS NOT NULL AS present`);
    const ledgerPresent = Boolean((ledger.rows?.[0] as any)?.present);
    let moneyMigrated = false;
    if (ledgerPresent) {
      const row = await db.execute(sql`
        SELECT 1 FROM app_migrations WHERE key = ${MONEY_MINOR_UNITS_KEY}`);
      moneyMigrated = (row.rows?.length ?? 0) > 0;
    }
    if (missingColumns.length || !moneyMigrated) {
      console.error(
        (moneyMigrated
          // Money is already in minor units; only additive columns are absent.
          // Re-running the script adds them and leaves the amounts alone (the
          // ledger key makes the money step a no-op).
          ? `REFUSING TO SERVE: this database is missing ${missingColumns.join(", ")}, which this build ` +
            "reads on every request. Run once (additive, safe to repeat):\n"
          : "REFUSING TO SERVE: this database has not been migrated to minor-unit money " +
            "and locale columns. This build reads amounts in paise/cents; the database " +
            "still holds whole rupees" +
            (missingColumns.length ? ` (missing ${missingColumns.join(", ")})` : "") +
            ". Stop the live instance, then run once:\n") +
        "    npx tsx --env-file=.env script/migrate-money-minor-units.ts --apply\n" +
        "(If you are a developer seeing this locally, you are probably pointed at the " +
        "shared production database — set DATABASE_URL to your local test DB.)",
      );
      process.exit(1);
    }
    log("schema gate: money in minor units and locale columns present");
  } catch (err) {
    console.error("REFUSING TO SERVE: could not verify the money/locale schema:", err);
    process.exit(1);
  }

  const httpServer = await registerRoutes(app);

  // Public server-rendered SEO/tool pages — MUST be registered before the SPA
  // catch-all (serveStatic / setupVite) so /tools/* and /blog/* return real
  // crawlable HTML instead of the SPA shell. Retired-page redirects go first
  // so a removed path can never fall through to a param route.
  registerLegacyRedirects(app);
  registerToolPages(app);
  registerBlogPages(app);
  registerCategoryPages(app);
  registerComparisonPages(app);

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
