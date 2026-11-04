/**
 * The strategy report against a REAL Postgres, checked against hand-calculated fixtures: window boundaries by
 * the message's created_at, grouping by strategy and prompt version, outcome deduplication through the unique
 * (organization, message, kind) index, follow-ups and other workspaces left out.
 *
 * Runs only with OUTREACH_PG_TEST_URL set to a disposable LOCAL database that has the schema and the
 * lead-messages, outreach-safety and draft-variants migrations applied. Each test's rows live in their own
 * organization and are deleted afterwards. Never point it at a shared or production database.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.OUTREACH_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("the strategy report adds up (real Postgres)", () => {
  let stats: typeof import("./strategy-stats");
  let q: any;
  const org = `test-${randomUUID()}`, otherOrg = `test-${randomUUID()}`;
  const user = { id: "u1", organizationId: org, orgRole: "OWNER" } as any;
  const NOW = new Date();
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
  let seq = 9_000_000;

  async function message(o: {
    org?: string; strategy: string | null; promptVersion: string; group?: string | null; createdDaysAgo: number;
    chosen?: boolean; approved?: boolean; edited?: boolean; sent?: boolean; status: string; events?: { kind: string; source: string; provider: string | null }[];
  }) {
    const id = ++seq, orgId = o.org ?? org, created = daysAgo(o.createdDaysAgo);
    await q.query(
      `INSERT INTO lead_messages (id, lead_id, organization_id, direction, channel, subject, body, body_hash, to_address, to_source, status, claim_ids, prompt_version, strategy, variant_group, chosen_at, edited, created_by, approved_at, sent_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'out', 'manual', 's', 'b', $4, 'a@x.test', 'site', $5, '[]', $6, $7, $8, $9, $10, 'user', $11, $12, $13, $13)`,
      [id, id, orgId, randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64), o.status, o.promptVersion, o.strategy, o.group ?? null,
        o.chosen ? created : null, o.edited ?? false, o.approved ? created : null, o.sent ? created : null, created],
    );
    for (const e of o.events ?? []) {
      // The same way recordEvent writes: the unique (organization, message, kind) index decides, a repeat is ignored.
      await q.query(
        `INSERT INTO outreach_events (organization_id, lead_id, message_id, kind, source, provider, provider_message_id, actor_user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, 'u1', now()) ON CONFLICT DO NOTHING`,
        [orgId, id, id, e.kind, e.source, e.provider],
      );
    }
    return id;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    stats = await import("./strategy-stats");
    const { default: P } = await import("pg");
    q = new P.Client({ connectionString: URL_ });
    await q.connect();

    // ── The fixtures, hand-calculated below. All in one batch-shaped story: ──
    const g1 = randomUUID(), g2 = randomUUID();
    // A fresh batch (1 day old): trigger chosen, edited, approved, sent; a reply recorded BOTH by hand and by the
    // Gmail sync (the index keeps one). Its siblings were shown and discarded.
    await message({ strategy: "trigger", promptVersion: "draft-v6:trigger", group: g1, createdDaysAgo: 1, chosen: true, approved: true, edited: true, sent: true, status: "sent", events: [{ kind: "replied", source: "manual", provider: null }, { kind: "replied", source: "provider", provider: "gmail" }] });
    await message({ strategy: "problem", promptVersion: "draft-v6:problem", group: g1, createdDaysAgo: 1, status: "cancelled" });
    await message({ strategy: "direct", promptVersion: "draft-v6:direct", group: g1, createdDaysAgo: 1, status: "cancelled" });
    // A fresh single trigger draft: approved unchanged, sent, bounced.
    await message({ strategy: "trigger", promptVersion: "draft-v6:trigger", createdDaysAgo: 1, approved: true, sent: true, status: "sent", events: [{ kind: "bounced", source: "manual", provider: null }] });
    // An older batch (40 days: inside 90, outside 30): problem chosen and sent, then an opt-out; trigger shown, not picked.
    await message({ strategy: "trigger", promptVersion: "draft-v6:trigger", group: g2, createdDaysAgo: 40, status: "cancelled" });
    await message({ strategy: "problem", promptVersion: "draft-v6:problem", group: g2, createdDaysAgo: 40, chosen: true, approved: true, sent: true, status: "sent", events: [{ kind: "opted_out", source: "manual", provider: null }] });
    // Outside both windows (100 days): never counted.
    await message({ strategy: "direct", promptVersion: "draft-v6:direct", createdDaysAgo: 100, approved: true, sent: true, status: "sent", events: [{ kind: "replied", source: "manual", provider: null }] });
    // A follow-up (no strategy) and another workspace's message: never counted.
    await message({ strategy: null, promptVersion: "followup-t1", createdDaysAgo: 1, sent: true, status: "sent", events: [{ kind: "replied", source: "manual", provider: null }] });
    await message({ org: otherOrg, strategy: "trigger", promptVersion: "draft-v6:trigger", createdDaysAgo: 1, sent: true, status: "sent", events: [{ kind: "replied", source: "manual", provider: null }] });
  });
  afterAll(async () => {
    for (const o of [org, otherOrg]) {
      await q.query(`DELETE FROM outreach_events WHERE organization_id = $1`, [o]);
      await q.query(`DELETE FROM lead_messages WHERE organization_id = $1`, [o]);
    }
    await q?.end();
  });

  const by = (rows: any[], strategy: string) => rows.find((r) => r.strategy === strategy);

  it("30 days: only the fresh batch and the fresh single, outcomes deduplicated, grouped by strategy and prompt version", async () => {
    const r = await stats.strategyStats(user, { days: "30" }, { now: () => NOW }) as any;
    expect(r.ok).toBe(true);
    expect(r.days).toBe(30);
    expect(r.rows.map((x: any) => [x.strategy, x.promptVersion])).toEqual([["direct", "draft-v6:direct"], ["problem", "draft-v6:problem"], ["trigger", "draft-v6:trigger"]]);
    // Hand-calculated: trigger = the chosen batch version (replied once, though recorded twice) + the single (bounced).
    expect(by(r.rows, "trigger")).toEqual({ strategy: "trigger", promptVersion: "draft-v6:trigger", generated: 2, shown: 1, chosen: 1, approved: 2, edited: 1, sent: 2, replied: 1, bounced: 1, optedOut: 0 });
    expect(by(r.rows, "problem")).toEqual({ strategy: "problem", promptVersion: "draft-v6:problem", generated: 1, shown: 1, chosen: 0, approved: 0, edited: 0, sent: 0, replied: 0, bounced: 0, optedOut: 0 });
    expect(by(r.rows, "direct")).toEqual({ strategy: "direct", promptVersion: "draft-v6:direct", generated: 1, shown: 1, chosen: 0, approved: 0, edited: 0, sent: 0, replied: 0, bounced: 0, optedOut: 0 });
  });

  it("90 days: the older batch joins, the 100-day message still doesn't", async () => {
    const r = await stats.strategyStats(user, { days: "90" }, { now: () => NOW }) as any;
    expect(r.days).toBe(90);
    expect(by(r.rows, "trigger")).toMatchObject({ generated: 3, shown: 2, chosen: 1, approved: 2, edited: 1, sent: 2, replied: 1, bounced: 1, optedOut: 0 });
    expect(by(r.rows, "problem")).toMatchObject({ generated: 2, shown: 2, chosen: 1, approved: 1, edited: 0, sent: 1, replied: 0, bounced: 0, optedOut: 1 });
    expect(by(r.rows, "direct")).toMatchObject({ generated: 1, shown: 1, sent: 0, replied: 0 });
  });

  it("follow-ups, other workspaces and strategy-less history never appear; a nonsense window falls back to 30", async () => {
    const r = await stats.strategyStats(user, { days: "9001" }, { now: () => NOW }) as any;
    expect(r.days).toBe(30);
    expect(r.rows.every((x: any) => x.promptVersion.startsWith("draft-v6:"))).toBe(true);
    const other = await stats.strategyStats({ ...user, organizationId: otherOrg }, { days: "30" }, { now: () => NOW }) as any;
    expect(other.rows).toHaveLength(1); // its own one message, nothing of ours
    expect(by(other.rows, "trigger")).toMatchObject({ generated: 1, replied: 1 });
  });
});
