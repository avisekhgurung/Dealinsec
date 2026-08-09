import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { storage } from "./storage";
import { sendEmail, welcomeEmail, passwordResetEmail } from "./emails";

const SALT_ROUNDS = 10;

export function generateOrgSlug(base: string): string {
  return (
    base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) +
    "-" + crypto.randomBytes(3).toString("hex")
  );
}

function generateReferralCode(email: string): string {
  const prefix = email.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, "X");
  const suffix = crypto.randomBytes(3).toString("hex").substring(0, 5).toUpperCase();
  return `${prefix}${suffix}`;
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}


// ── Brute-force protection ────────────────────────────────────────────
// In-memory sliding counters. Deliberately simple: no dependency, no
// migration. A deploy resets them, which is acceptable for a throttle (it
// is not an authorisation control) — the Postgres-backed version is the
// follow-up in the pre-launch checklist.
const attempts = new Map<string, { n: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;

function clientIp(req: any): string {
  const cf = req.headers["cf-connecting-ip"];
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s: string) => s.trim()).filter(Boolean);
  return (cf ? String(cf) : xff.length ? xff[xff.length - 1] : req.ip || "unknown").trim() || "unknown";
}

/** Returns true when the caller is over budget for this key. */
function throttled(key: string, limit: number): boolean {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) {
    if (attempts.size > 10_000) attempts.clear();
    attempts.set(key, { n: 1, first: now });
    return false;
  }
  rec.n++;
  return rec.n > limit;
}

/** Clear a key after a legitimate success so honest users never accumulate. */
function clearThrottle(key: string) {
  attempts.delete(key);
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  // Session is registered in index.ts before passport, so we don't register it again here

  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { email, password, firstName, lastName, role } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      if (role && role !== "influencer") {
        return res.status(400).json({ message: "Only influencer signup is available right now" });
      }

      // 5 new accounts / 15 min from one IP is far above honest use.
      if (throttled(`signup:${clientIp(req)}`, 5)) {
        return res.status(429).json({ message: "Too many sign-up attempts. Please wait a few minutes." });
      }

      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      // Every account belongs to an organization: signup creates one and the
      // user becomes its OWNER. Column defaults grant the org's 4 monthly Deal
      // Credits (billing lives on the owner's row).
      const orgBase = (firstName || email.split("@")[0] || "My").trim();
      const org = await storage.createOrganization(`${orgBase}'s Workspace`, generateOrgSlug(orgBase));

      const user = await storage.createUser({
        email,
        password: hashedPassword,
        firstName: firstName || null,
        lastName: lastName || null,
        role: "influencer",
        onboardingComplete: false,
        referralCode: generateReferralCode(email),
        organizationId: org.id,
        orgRole: "OWNER",
        memberStatus: "active",
        joinedAt: new Date(),
      } as any);

      (req.session as any).userId = user.id;

      // Welcome email — best-effort, non-blocking
      if (user.email) {
        const { subject, html } = welcomeEmail({ firstName: user.firstName || undefined });
        void sendEmail({ to: user.email, subject, html });
      }

      const { password: _, ...userWithoutPassword } = user;
      res.status(201).json(userWithoutPassword);
    } catch (error) {
      console.error("Signup error:", error);
      res.status(500).json({ message: "Failed to create account" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const ip = clientIp(req);
      // 10 attempts / 15 min per IP, 5 per email — a human typo-ing their
      // password stays well inside this; credential stuffing does not.
      if (throttled(`login:ip:${ip}`, 10) || throttled(`login:em:${String(email).toLowerCase()}`, 5)) {
        return res.status(429).json({ message: "Too many sign-in attempts. Please wait a few minutes and try again." });
      }

      const user = await storage.getUserByEmail(email);
      if (!user || !user.password) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      clearThrottle(`login:ip:${ip}`);
      clearThrottle(`login:em:${String(email).toLowerCase()}`);
      (req.session as any).userId = user.id;

      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Failed to login" });
    }
  });

  // ── Password reset ───────────────────────────────────────────────────
  // Request: ALWAYS 200 (no account enumeration). The raw token lives only
  // in the email; we store its bcrypt hash + a 30-minute expiry. A 5-minute
  // cooldown between emails per account keeps the endpoint from being a
  // mail cannon.
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      if (throttled(`forgot:${clientIp(req)}`, 8)) {
        return res.json({ ok: true }); // stay generic — no enumeration signal
      }
      const email = String(req.body?.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: "Please enter a valid email" });
      }
      const user = await storage.getUserByEmail(email);
      if (user && user.email) {
        const existingExpiry = (user as any).resetTokenExpiresAt
          ? new Date((user as any).resetTokenExpiresAt).getTime()
          : 0;
        // Issued less than 5 minutes ago (expiry is issue+30m) → skip resend.
        const issuedRecently = existingExpiry - Date.now() > 25 * 60 * 1000;
        if (!issuedRecently) {
          const token = crypto.randomBytes(32).toString("hex");
          const hash = await bcrypt.hash(token, SALT_ROUNDS);
          await storage.updateUser(user.id, {
            resetTokenHash: hash,
            resetTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
          } as any);
          const { subject, html } = passwordResetEmail({
            firstName: user.firstName || undefined,
            email: user.email,
            token,
          });
          void sendEmail({ to: user.email, subject, html });
        }
      }
      res.json({ ok: true });
    } catch (error) {
      console.error("Forgot-password error:", error);
      // Still generic — the caller learns nothing about accounts.
      res.json({ ok: true });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      if (throttled(`reset:${clientIp(req)}`, 10)) {
        return res.status(429).json({ message: "Too many attempts. Please request a fresh reset link." });
      }
      const email = String(req.body?.email || "").trim().toLowerCase();
      const token = String(req.body?.token || "");
      const password = String(req.body?.password || "");
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      const user = await storage.getUserByEmail(email);
      const hash = (user as any)?.resetTokenHash as string | undefined;
      const expires = (user as any)?.resetTokenExpiresAt
        ? new Date((user as any).resetTokenExpiresAt).getTime()
        : 0;
      const valid = !!user && !!hash && !!token && expires > Date.now() &&
        (await bcrypt.compare(token, hash!));
      if (!valid) {
        return res.status(400).json({
          code: "RESET_INVALID",
          message: "This reset link is invalid or has expired. Request a new one.",
        });
      }
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      await storage.updateUser(user!.id, {
        password: hashedPassword,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      } as any);
      // Sign them straight in — the reset email already proved mailbox control.
      (req.session as any).userId = user!.id;
      res.json({ ok: true });
    } catch (error) {
      console.error("Reset-password error:", error);
      res.status(500).json({ message: "Could not reset password" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out successfully" });
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const userId = (req.session as any)?.userId;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = await storage.getUser(userId);
  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Members removed from their organization lose access immediately.
  if ((user as any).memberStatus === "removed") {
    return res.status(401).json({ message: "Your access to this organization was removed" });
  }

  // Custom-role members carry their live permission set on the session:
  // memberCan() (shared/permissions.ts) reads customPermissions here and in
  // the client. Loaded per request so a matrix edit by the owner applies on
  // the member's very next request; a deleted role degrades the member to
  // view-only rather than erroring.
  if ((user as any).customRoleId) {
    const role = await storage.getOrgRole((user as any).customRoleId);
    (user as any).customPermissions =
      role && role.organizationId === (user as any).organizationId ? role.permissions : [];
  }

  (req as any).user = user;
  next();
};
