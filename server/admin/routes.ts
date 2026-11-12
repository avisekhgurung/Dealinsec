/**
 * Platform-admin HTTP surface (all under /api/admin, all behind isAuthenticated + requirePlatformAdmin, no-store):
 *
 *   GET    /api/admin/overview            totals: credits consumed, top-up revenue, outstanding credits, feature-wise usage
 *   GET    /api/admin/packs               every credit pack (active or not) with how many were sold
 *   POST   /api/admin/packs               create a pack
 *   PATCH  /api/admin/packs/:id           change quantity, price, active, order, expiry
 *   DELETE /api/admin/packs/:id           remove a pack nobody ever bought (otherwise deactivate it)
 *   GET    /api/admin/config              effective allowances, overrides, thresholds, credit costs, expiry default, reset rule
 *   PUT    /api/admin/config/:key         change one setting (validated server-side)
 *   GET    /api/admin/users               search / filter accounts (q, plan, credits, page)
 *   GET    /api/admin/users/:id           one account: plan, balances, usage, lots, ledger, purchases
 *   POST   /api/admin/users/:id/credits   grant or deduct credits: mandatory reason, idempotent by requestId
 *   GET    /api/admin/audit               the admin audit log, newest first
 *   GET    /api/admin/export?type=        CSV: users | purchases | ledger
 *
 * Every change writes an admin_audit_log line in the SAME transaction as the change (who, what, old and new, why).
 * Nothing here is reachable by an organization role, owner included.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { adminAuditLog, creditPacks, creditPurchases, CREDIT_KINDS, type CreditKind } from "@shared/schema";
import { OUTBOUND_ALLOWANCE_DEFAULTS, OUTBOUND_WINDOW_DAYS } from "@shared/outbound-plans";
import { BILLING_CONFIG_KEYS, type BillingConfigKey } from "@shared/billing-config";
import { db } from "../db";
import { storage } from "../storage";
import { isAuthenticated } from "../auth";
import { outboundAllowance } from "../outbound/limits";
import { outboundTier } from "../outbound/plan";
import { billingConfig } from "../billing/config-cache";
import { setBillingConfig } from "../billing/config-store";
import { adminDeductCredits, adminGrantCredits, writeAudit } from "../billing/credits";
import { getWallet } from "../billing/wallet";
import { requirePlatformAdmin } from "./guard";
import { toCsv } from "./csv";

const kind = z.enum(CREDIT_KINDS);
const packBody = z.object({
  kind,
  units: z.number().int().min(1).max(100_000),
  priceRupees: z.number().int().min(1).max(100_000),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(-1000).max(1000).optional(),
  expiryMonths: z.number().int().min(1).max(60).nullable().optional(),
  reason: z.string().trim().max(300).optional(),
});
const packPatch = packBody.partial();
const creditOp = z.object({
  action: z.enum(["grant", "deduct"]),
  kind,
  units: z.number().int().min(1).max(100_000),
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required").max(300),
  requestId: z.string().trim().min(8).max(64),
  // Optional: a grant may expire (days from now); omitted = never.
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

const pid = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const bad = (res: Response, status: number, code: string, error: string) => res.status(status).json({ code, error });
const zerr = (res: Response, e: z.ZodError) => bad(res, 400, "invalid", e.issues[0]?.message ? `${e.issues[0].path.join(".") || "request"}: ${e.issues[0].message}` : "Invalid request");

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function registerAdminRoutes(app: Express) {
  const gate = [isAuthenticated, requirePlatformAdmin];
  const wrap = (where: string, fn: (req: any, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try { res.setHeader("Cache-Control", "no-store"); await fn(req, res); }
    catch (e) {
      console.error(`admin ${where} failed:`, (e as Error)?.message ?? e);
      res.status(500).json({ code: "internal", error: "Something went wrong on our side." });
    }
  };

  /* ── overview ───────────────────────────────────────────────────────────── */
  app.get("/api/admin/overview", ...gate, wrap("overview", async (_req, res) => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [consumed, revenue, outstanding, runs, drafts, sold] = await Promise.all([
      db.execute(sql`SELECT kind, COALESCE(sum(CASE reason WHEN 'consume' THEN -delta WHEN 'consume_undo' THEN -delta ELSE 0 END), 0)::int AS n
        FROM credit_ledger WHERE reason IN ('consume', 'consume_undo') AND created_at >= ${since}::timestamp GROUP BY kind`),
      db.execute(sql`SELECT p.kind, o.status, count(*)::int AS orders, COALESCE(sum(p.price_rupees), 0)::int AS rupees,
        COALESCE(sum(p.price_rupees) FILTER (WHERE o.completed_at >= ${since}::timestamp), 0)::int AS rupees_30d
        FROM credit_purchases p JOIN payu_orders o ON o.order_id = p.order_id GROUP BY p.kind, o.status`),
      db.execute(sql`SELECT kind, COALESCE(sum(remaining), 0)::int AS n FROM credit_lots WHERE remaining > 0 AND (expires_at IS NULL OR expires_at > now()) GROUP BY kind`),
      db.execute(sql`SELECT mode, COALESCE(funded_by, 'plan') AS funded_by, count(*)::int AS n FROM prospect_runs
        WHERE created_at >= ${since}::timestamp AND (status = 'running' OR COALESCE((counters->>'searched')::int, 0) > 0) GROUP BY mode, COALESCE(funded_by, 'plan')`),
      db.execute(sql`SELECT COALESCE(funded_by, 'plan') AS funded_by, count(*)::int AS n FROM (
          SELECT funded_by, COALESCE(variant_group, id::text) AS g FROM lead_messages WHERE direction = 'out' AND prompt_version LIKE 'draft-%' AND created_at >= ${since}::timestamp
          UNION ALL SELECT funded_by, id::text FROM channel_messages WHERE direction = 'out' AND prompt_version LIKE 'draft-%' AND created_at >= ${since}::timestamp) x GROUP BY COALESCE(funded_by, 'plan')`).catch(() => ({ rows: [] })),
      db.execute(sql`SELECT pack_id, count(*)::int AS n FROM credit_purchases p JOIN payu_orders o ON o.order_id = p.order_id WHERE o.status = 'completed' GROUP BY pack_id`),
    ]);
    res.json({
      windowDays: 30,
      consumed: consumed.rows, revenue: revenue.rows, outstanding: outstanding.rows, runs: runs.rows, drafts: drafts.rows, soldByPack: sold.rows,
    });
  }));

  /* ── packs ──────────────────────────────────────────────────────────────── */
  app.get("/api/admin/packs", ...gate, wrap("packs", async (_req, res) => {
    const packs = await db.select().from(creditPacks).orderBy(creditPacks.kind, creditPacks.sortOrder, creditPacks.id);
    const sold = await db.execute(sql`SELECT p.pack_id, count(*)::int AS n FROM credit_purchases p JOIN payu_orders o ON o.order_id = p.order_id WHERE o.status = 'completed' GROUP BY p.pack_id`);
    const by = new Map((sold.rows as { pack_id: number; n: number }[]).map((r) => [Number(r.pack_id), Number(r.n)]));
    res.json({ packs: packs.map((p) => ({ ...p, sold: by.get(p.id) ?? 0 })), kinds: CREDIT_KINDS, defaultExpiryMonths: billingConfig().defaultExpiryMonths });
  }));

  app.post("/api/admin/packs", ...gate, wrap("pack_create", async (req, res) => {
    const p = packBody.safeParse(req.body);
    if (!p.success) return zerr(res, p.error);
    const now = new Date();
    const row = await db.transaction(async (tx) => {
      const [r] = await tx.insert(creditPacks).values({
        kind: p.data.kind, units: p.data.units, priceRupees: p.data.priceRupees, active: p.data.active ?? true, sortOrder: p.data.sortOrder ?? 0,
        expiryMonths: p.data.expiryMonths === undefined ? billingConfig().defaultExpiryMonths : p.data.expiryMonths, createdAt: now, updatedAt: now,
      }).returning();
      await writeAudit(tx, { adminUserId: req.user.id, action: "pack.create", target: `pack:${r.id}`, reason: p.data.reason ?? null, detail: { after: r } }, now);
      return r;
    });
    res.status(201).json({ pack: row });
  }));

  app.patch("/api/admin/packs/:id", ...gate, wrap("pack_update", async (req, res) => {
    const id = pid(req.params.id);
    if (!id) return bad(res, 404, "not_found", "No such pack.");
    const p = packPatch.safeParse(req.body);
    if (!p.success) return zerr(res, p.error);
    const { reason, ...fields } = p.data;
    const now = new Date();
    const out = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(creditPacks).where(eq(creditPacks.id, id)).limit(1).for("update");
      if (!before) return null;
      const [after] = await tx.update(creditPacks).set({ ...fields, updatedAt: now }).where(eq(creditPacks.id, id)).returning();
      await writeAudit(tx, { adminUserId: req.user.id, action: "pack.update", target: `pack:${id}`, reason: reason ?? null, detail: { before, after } }, now);
      return after;
    });
    if (!out) return bad(res, 404, "not_found", "No such pack.");
    res.json({ pack: out });
  }));

  app.delete("/api/admin/packs/:id", ...gate, wrap("pack_delete", async (req, res) => {
    const id = pid(req.params.id);
    if (!id) return bad(res, 404, "not_found", "No such pack.");
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(creditPacks).where(eq(creditPacks.id, id)).limit(1).for("update");
      if (!before) return "missing" as const;
      const [bought] = await tx.select({ n: sql<number>`count(*)::int` }).from(creditPurchases).where(eq(creditPurchases.packId, id));
      if ((bought?.n ?? 0) > 0) return "bought" as const;
      await tx.delete(creditPacks).where(eq(creditPacks.id, id));
      await writeAudit(tx, { adminUserId: req.user.id, action: "pack.delete", target: `pack:${id}`, reason: null, detail: { before } }, now);
      return "ok" as const;
    });
    if (result === "missing") return bad(res, 404, "not_found", "No such pack.");
    if (result === "bought") return bad(res, 409, "pack_has_orders", "This pack has been ordered before, so it can't be deleted. Switch it off instead.");
    res.json({ deleted: true });
  }));

  /* ── config ─────────────────────────────────────────────────────────────── */
  app.get("/api/admin/config", ...gate, wrap("config", async (_req, res) => {
    const cfg = billingConfig();
    res.json({
      config: cfg,
      allowances: {
        // What actually applies now (override > environment > code default), and the code default, so the admin sees the fallback.
        effective: { free: outboundAllowance("free"), pro: outboundAllowance("pro") },
        codeDefaults: { free: OUTBOUND_ALLOWANCE_DEFAULTS.free, pro: OUTBOUND_ALLOWANCE_DEFAULTS.pro },
      },
      // The reset rule is the rolling window; it is shown, not editable (see the wallet: a window change rewrites every
      // person's remaining allowance at once and is a founder decision, not a form field).
      resetRule: { kind: "rolling", windowDays: OUTBOUND_WINDOW_DAYS, editable: false },
      keys: BILLING_CONFIG_KEYS,
    });
  }));

  app.put("/api/admin/config/:key", ...gate, wrap("config_set", async (req, res) => {
    const key = String(req.params.key) as BillingConfigKey;
    if (!(BILLING_CONFIG_KEYS as readonly string[]).includes(key)) return bad(res, 404, "not_found", "Unknown setting.");
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 300) || null : null;
    const r = await setBillingConfig(key, req.body?.value, req.user.id, reason);
    if (!r.ok) return bad(res, 400, "invalid", r.error);
    res.json({ config: billingConfig() });
  }));

  /* ── users ──────────────────────────────────────────────────────────────── */
  app.get("/api/admin/users", ...gate, wrap("users", async (req, res) => {
    const q = String(req.query.q ?? "").trim().slice(0, 80);
    const planFilter = req.query.plan === "pro" || req.query.plan === "free" ? String(req.query.plan) : null;
    const withCredits = req.query.credits === "1";
    const page = Math.max(1, Math.min(1000, Number(req.query.page) || 1)), size = 25;
    const where = sql`WHERE true
      ${q ? sql`AND (u.email ILIKE ${like(q)} OR u.first_name ILIKE ${like(q)} OR u.last_name ILIKE ${like(q)} OR u.id = ${q} OR u.organization_id = ${q})` : sql``}
      ${planFilter === "pro" ? sql`AND u.plan = 'pro' AND u.plan_expires_at > now()` : planFilter === "free" ? sql`AND NOT (u.plan = 'pro' AND u.plan_expires_at > now())` : sql``}
      ${withCredits ? sql`AND EXISTS (SELECT 1 FROM credit_lots l WHERE l.organization_id = u.organization_id AND l.remaining > 0 AND (l.expires_at IS NULL OR l.expires_at > now()))` : sql``}`;
    const [rows, total] = await Promise.all([
      db.execute(sql`SELECT u.id, u.email, u.first_name, u.last_name, u.organization_id, u.org_role, u.plan, u.plan_expires_at, u.created_at,
          COALESCE((SELECT sum(l.remaining) FROM credit_lots l WHERE l.organization_id = u.organization_id AND l.kind = 'search' AND l.remaining > 0 AND (l.expires_at IS NULL OR l.expires_at > now())), 0)::int AS search_credits,
          COALESCE((SELECT sum(l.remaining) FROM credit_lots l WHERE l.organization_id = u.organization_id AND l.kind = 'draft' AND l.remaining > 0 AND (l.expires_at IS NULL OR l.expires_at > now())), 0)::int AS draft_credits
        FROM users u ${where} ORDER BY u.created_at DESC NULLS LAST LIMIT ${size} OFFSET ${(page - 1) * size}`),
      db.execute(sql`SELECT count(*)::int AS n FROM users u ${where}`),
    ]);
    res.json({ users: rows.rows, page, pageSize: size, total: Number((total.rows[0] as { n: number }).n) });
  }));

  app.get("/api/admin/users/:id", ...gate, wrap("user", async (req, res) => {
    const u = await storage.getUser(String(req.params.id).slice(0, 64));
    if (!u) return bad(res, 404, "not_found", "No such account.");
    const tier = await outboundTier(u as any).catch(() => "free" as const);
    const wallet = u.organizationId ? await getWallet(u as any) : null;
    res.json({
      user: {
        id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, organizationId: u.organizationId, orgRole: u.orgRole,
        plan: u.plan, planTerm: u.planTerm, planExpiresAt: u.planExpiresAt, createdAt: u.createdAt, tier,
      },
      wallet,
    });
  }));

  app.post("/api/admin/users/:id/credits", ...gate, wrap("user_credits", async (req, res) => {
    const p = creditOp.safeParse(req.body);
    if (!p.success) return zerr(res, p.error);
    const u = await storage.getUser(String(req.params.id).slice(0, 64));
    if (!u) return bad(res, 404, "not_found", "No such account.");
    if (!u.organizationId) return bad(res, 409, "no_organization", "This account has no workspace to hold credits.");
    const label = `user:${u.id} org:${u.organizationId}`;
    if (p.data.action === "grant") {
      const r = await adminGrantCredits({
        orgId: u.organizationId, kind: p.data.kind as CreditKind, units: p.data.units, reason: p.data.reason, adminUserId: req.user.id, requestId: p.data.requestId, targetLabel: label,
        expiresAt: p.data.expiresInDays ? new Date(Date.now() + p.data.expiresInDays * 86_400_000) : null,
      });
      return res.json({ ok: true, replay: r.replay, granted: r.replay ? 0 : p.data.units });
    }
    const r = await adminDeductCredits({ orgId: u.organizationId, kind: p.data.kind as CreditKind, units: p.data.units, reason: p.data.reason, adminUserId: req.user.id, requestId: p.data.requestId, targetLabel: label });
    res.json({ ok: true, replay: r.replay, removed: r.removed });
  }));

  /* ── audit + export ─────────────────────────────────────────────────────── */
  app.get("/api/admin/audit", ...gate, wrap("audit", async (_req, res) => {
    const rows = await db.select().from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id)).limit(200);
    res.json({ entries: rows });
  }));

  app.get("/api/admin/export", ...gate, wrap("export", async (req, res) => {
    const type = String(req.query.type ?? "");
    let csv: string;
    if (type === "purchases") {
      const r = await db.execute(sql`SELECT o.order_id, o.status, u.email, p.organization_id, p.kind, p.units, p.price_rupees, p.expiry_months, o.created_at, o.completed_at
        FROM credit_purchases p JOIN payu_orders o ON o.order_id = p.order_id LEFT JOIN users u ON u.id = p.user_id ORDER BY o.created_at DESC LIMIT 5000`);
      csv = toCsv(["order_id", "status", "email", "organization_id", "kind", "units", "price_rupees", "expiry_months", "created_at", "completed_at"],
        (r.rows as Record<string, unknown>[]).map((x) => [x.order_id, x.status, x.email, x.organization_id, x.kind, x.units, x.price_rupees, x.expiry_months, x.created_at, x.completed_at]));
    } else if (type === "ledger") {
      const r = await db.execute(sql`SELECT id, organization_id, kind, delta, reason, lot_id, source_ref, note, actor_user_id, created_at FROM credit_ledger ORDER BY id DESC LIMIT 5000`);
      csv = toCsv(["id", "organization_id", "kind", "delta", "reason", "lot_id", "source_ref", "note", "actor_user_id", "created_at"],
        (r.rows as Record<string, unknown>[]).map((x) => [x.id, x.organization_id, x.kind, x.delta, x.reason, x.lot_id, x.source_ref, x.note, x.actor_user_id, x.created_at]));
    } else if (type === "users") {
      const since = new Date(Date.now() - OUTBOUND_WINDOW_DAYS * 86_400_000).toISOString();
      const r = await db.execute(sql`SELECT u.id, u.email, u.organization_id, u.plan, u.plan_expires_at,
          COALESCE((SELECT sum(l.remaining) FROM credit_lots l WHERE l.organization_id = u.organization_id AND l.kind = 'search' AND l.remaining > 0 AND (l.expires_at IS NULL OR l.expires_at > now())), 0)::int AS search_credits,
          COALESCE((SELECT sum(l.remaining) FROM credit_lots l WHERE l.organization_id = u.organization_id AND l.kind = 'draft' AND l.remaining > 0 AND (l.expires_at IS NULL OR l.expires_at > now())), 0)::int AS draft_credits,
          (SELECT count(*) FROM prospect_runs r WHERE r.organization_id = u.organization_id AND r.created_at >= ${since}::timestamp AND (r.status = 'running' OR COALESCE((r.counters->>'searched')::int, 0) > 0))::int AS runs_30d
        FROM users u WHERE u.org_role = 'OWNER' ORDER BY u.created_at DESC NULLS LAST LIMIT 5000`);
      csv = toCsv(["user_id", "email", "organization_id", "plan", "plan_expires_at", "search_credits", "draft_credits", "searches_30d"],
        (r.rows as Record<string, unknown>[]).map((x) => [x.id, x.email, x.organization_id, x.plan, x.plan_expires_at, x.search_credits, x.draft_credits, x.runs_30d]));
    } else return bad(res, 400, "invalid", "type must be users, purchases or ledger");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="dealinsec-${type}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).end(csv);
  }));
}

