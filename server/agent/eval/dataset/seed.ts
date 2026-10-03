/**
 * Turning a case's WorldSpec into records in the in-memory world, and resolving
 * the `{{deal.acme}}` placeholders in turns and expectations to the ids those
 * records received. Pure apart from mutating the world it is handed.
 */
import { createWorld, seedContract, seedDeal, seedInvoice, seedQuote, userRow, ORG1, ORG2, type Row, type World } from "../world";
import type { WorldSpec } from "./schema";

export type Refs = { deal: Record<string, number>; invoice: Record<string, number>; contract: Record<string, number> };

const DAY = 86_400_000;
const isoIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

export function buildWorld(spec: WorldSpec): { world: World; user: Row; refs: Refs } {
  const world = createWorld();
  const refs: Refs = { deal: {}, invoice: {}, contract: {} };

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
  return { world, user, refs };
}

/** Replace `{{deal.acme}}`, `{{invoice.inv1}}`, `{{contract.c1}}` anywhere in a JSON-like value. */
export function resolveRefs<T>(value: T, refs: Refs): T {
  const sub = (s: string) =>
    s.replace(/\{\{(deal|invoice|contract)\.([a-z][a-z0-9_]*)\}\}/g, (_m, kind: keyof Refs, name: string) => {
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
  return JSON.stringify({ deals: strip(w.deals), quotes: strip(w.quotes), contracts: strip(w.contracts), invoices: strip(w.invoices) });
}
