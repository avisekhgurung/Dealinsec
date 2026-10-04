/**
 * Turning a case's WorldSpec into records in the in-memory world, and resolving
 * the `{{deal.acme}}` placeholders in turns and expectations to the ids those
 * records received. Pure apart from mutating the world it is handed.
 */
import { createHash } from "node:crypto";
import { isoDateInZone } from "@shared/invoice-numbering";
import { chunkText } from "@shared/knowledge";
import { createWorld, seedContract, seedDeal, seedInvoice, seedLead, seedProfile, seedQuote, userRow, ORG1, ORG2, type Row, type World } from "../world";
import type { WorldSpec } from "./schema";

export type Refs = { deal: Record<string, number>; invoice: Record<string, number>; contract: Record<string, number>; lead: Record<string, number> };

const DAY = 86_400_000;
// Dates are the seeded organization's calendar days (India), not UTC days: the two differ for ~5.5 hours every evening.
const isoIn = (days: number) => isoDateInZone("Asia/Kolkata", new Date(Date.now() + days * DAY));

const leadRow = (l: WorldSpec["leads"][number]) => ({
  companyName: l.companyName, status: l.status,
  ...(l.industry ? { industry: l.industry } : {}), ...(l.location ? { location: l.location } : {}),
  ...(l.website ? { website: l.website, domain: l.website.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") } : {}),
  ...(l.estValueMinor ? { estValueMinor: l.estValueMinor, currency: "INR" } : {}),
  ...(l.contactEmail ? { contactEmail: l.contactEmail } : {}), ...(l.doNotContact ? { doNotContact: true } : {}),
});

/** The draft every seeded message carries, and its hash (the same formula as server/sales/outreach.ts hashDraft). */
export const SEED_SUBJECT = "A quick note about Casa Alma Porto";
export const SEED_BODY = "Hello,\n\nI saw that Casa Alma runs boutique hotels in Lisbon and has just opened a second hotel in Porto. Congratulations. I help small hotel groups keep their client paperwork tidy, and I wondered whether that is something you are thinking about as you grow.\n\nWould a short reply or a quick chat be useful?\n\nBest,\nAsha Rao";
const seedHash = createHash("sha256").update(`${SEED_SUBJECT.trim()}\n${SEED_BODY.trim()}`).digest("hex");

export function buildWorld(spec: WorldSpec): { world: World; user: Row; refs: Refs } {
  const world = createWorld();
  const refs: Refs = { deal: {}, invoice: {}, contract: {}, lead: {} };

  world.orgs.get(ORG1)!.audience = spec.audience === "client_work" ? null : spec.audience;
  if (spec.plan === "free") world.billing.set(ORG1, { id: "u1", plan: "free" });
  const user = userRow(spec.user ?? {});
  world.users.set("u1", user);

  for (const d of spec.deals) {
    const row = seedDeal(world, {
      brandName: d.brandName, dealTitle: d.dealTitle, dealAmountMinor: d.amountMinor, status: d.status,
      ...(d.dealType ? { dealType: d.dealType } : {}), ...(d.customTerms ? { customTerms: d.customTerms } : {}),
    });
    refs.deal[d.ref] = row.id;
  }
  for (const q of spec.quotes) seedQuote(world, refs.deal[q.deal], { status: q.status });
  for (const c of spec.contracts) {
    const row = seedContract(world, refs.deal[c.deal], c.signed ? { signedByBrand: true, status: "Signed" } : {});
    refs.contract[c.ref] = row.id;
  }
  for (const i of spec.invoices) {
    const row = seedInvoice(world, refs.deal[i.deal], {
      status: i.status, dealAmountMinor: i.amountMinor, dueDate: isoIn(i.dueInDays),
      ...(i.status === "Paid" ? { paidAt: new Date() } : {}),
    });
    refs.invoice[i.ref] = row.id;
  }
  for (const f of spec.foreignDeals) {
    const row = seedDeal(world, { organizationId: ORG2, userId: "u2", brandName: f.brandName, dealTitle: f.dealTitle });
    refs.deal[f.ref] = row.id;
  }
  if (spec.discovery) { world.discovery.configured = spec.discovery.configured; world.discovery.results = spec.discovery.results; }
  if (spec.idealClient) seedProfile(world, { ...spec.idealClient, minDealMinor: spec.idealClient.minDealMinor ?? null, currency: spec.idealClient.minDealMinor ? "INR" : null });
  for (const l of spec.leads) {
    const row = seedLead(world, leadRow(l));
    refs.lead[l.ref] = row.id;
    for (const c of l.claims) {
      const site = (row.domain as string | undefined) ?? "example.test";
      world.leads.claims.push({ id: 9000 + world.leads.claims.length, leadId: row.id, organizationId: ORG1, field: c.field, value: c.value, status: c.status, evidenceUrl: c.status === "confirmed" ? `https://${site}/about` : null, evidenceSnippet: c.status === "confirmed" ? c.value : null, source: "agent", retrievedAt: new Date(), createdAt: new Date() } as any);
    }
    if (l.researched) world.research.push({ id: world.research.length + 1, leadId: row.id, organizationId: ORG1, status: "done", startedAt: new Date(), claimIds: [] });
    for (const t of l.tickets) {
      world.leads.tickets.push({
        id: world.leads.tickets.length + 1, leadId: row.id, organizationId: ORG1, title: t.title, kind: "other", status: "open",
        dueAt: t.dueInDays === undefined ? null : new Date(`${isoIn(t.dueInDays)}T00:00:00Z`), createdBy: "user", doneAt: null, createdAt: new Date(),
      } as any);
    }
  }
  for (const m of spec.messages ?? []) {
    const now = new Date();
    world.messages.push({ id: world.messages.length + 1, leadId: refs.lead[m.lead], organizationId: ORG1, direction: "out", channel: "manual", subject: SEED_SUBJECT, body: SEED_BODY, bodyHash: seedHash, toAddress: m.to, toSource: "site", status: m.status, researchId: null, claimIds: [], promptVersion: "draft-v1", edited: false, createdBy: "agent", createdByUser: "u1", approvedBy: m.status === "draft" ? null : "u1", approvedAt: m.status === "draft" ? null : now, sentAt: m.status === "sent" ? now : null, createdAt: now, updatedAt: now });
  }
  (spec.knowledge ?? []).forEach((k, i) => {
    const id = `ks-seed-${i + 1}`;
    const chunks = chunkText(k.text);
    world.knowledge.sources.push({ id, organizationId: ORG1, kind: "note", title: k.title, sourceUrl: null, sha256: `seed-${i + 1}`, chars: k.text.length, chunkCount: chunks.length, truncated: false, createdAt: new Date() });
    chunks.forEach((content, position) => world.knowledge.chunks.push({ sourceId: id, organizationId: ORG1, position, content }));
  });
  for (const l of spec.foreignLeads) refs.lead[l.ref] = seedLead(world, { ...leadRow(l), ownerUserId: "u2" }, ORG2).id;
  return { world, user, refs };
}

/** Replace `{{deal.acme}}`, `{{invoice.inv1}}`, `{{contract.c1}}`, `{{lead.north}}` anywhere in a JSON-like value. */
export function resolveRefs<T>(value: T, refs: Refs): T {
  const sub = (s: string) =>
    s.replace(/\{\{(deal|invoice|contract|lead)\.([a-z][a-z0-9_]*)\}\}/g, (_m, kind: keyof Refs, name: string) => {
      const id = refs[kind][name];
      if (id === undefined) throw new Error(`dataset placeholder {{${kind}.${name}}} has no matching record`);
      return String(id);
    });
  const walk = (v: unknown): unknown =>
    typeof v === "string" ? sub(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
  return walk(value) as T;
}

/** A comparable fingerprint of everything the agent could change. */
export function snapshotWorld(w: World): string {
  const strip = (rows: Row[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "createdAt")));
  return JSON.stringify({ deals: strip(w.deals), quotes: strip(w.quotes), contracts: strip(w.contracts), invoices: strip(w.invoices), leads: strip(w.leads.leads as any), tickets: strip(w.leads.tickets as any), claims: strip(w.leads.claims as any), events: w.leads.events.length, messages: strip(w.messages), research: strip(w.research), llmCalls: w.llmCalls.length, profiles: Array.from(w.profiles.values()).map((p) => ({ ...p, updatedAt: 0 })), knowledge: strip(w.knowledge.sources).map((r: any) => r.id).concat(w.knowledge.chunks.length as any), orgs: Array.from(w.orgs.values()), users: Array.from(w.users.values()) });
}
