/**
 * Human-approved outreach MVP, in the in-memory world: preparing drafts for selected prospects, the review queue, the
 * do-not-contact list, outcomes after sending, and the rules no click, retry or other organization may get past.
 * Nothing here sends email: the world's outbox must stay empty throughout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", async () => (await import("./world-mocks")).storageMock());
vi.mock("../../entitlements", async () => (await import("./world-mocks")).entitlementsMock());
vi.mock("../../emails", async () => (await import("./world-mocks")).emailsMock());
vi.mock("../../leads/profile-store", async () => (await import("./world-mocks")).profileStoreMock());
vi.mock("../../discovery/provider", async () => (await import("./world-mocks")).discoveryProviderMock());
vi.mock("../../discovery/usage", async () => (await import("./world-mocks")).discoveryUsageMock());
vi.mock("../../documents/style-store", async () => (await import("./world-mocks")).documentStyleStoreMock());
vi.mock("../../knowledge/store", async () => (await import("./world-mocks")).knowledgeStoreMock());
vi.mock("../../knowledge/net-guard", async (orig) => (await import("./world-mocks")).netGuardMock(orig as () => Promise<any>));
vi.mock("../../leads/store", async () => (await import("./world-mocks")).leadsStoreMock());
vi.mock("../../sales/research-store", async () => (await import("./world-mocks")).researchStoreMock());
vi.mock("../../sales/message-store", async () => (await import("./world-mocks")).messageStoreMock());
vi.mock("../../outbound/store", async () => (await import("./world-mocks")).outboundStoreMock());
vi.mock("../../llm/trace-store", async () => (await import("./world-mocks")).traceStoreMock());
vi.mock("../../routes", async () => (await import("./world-mocks")).routesMock());
vi.mock("../../copilot/provider", async (orig) => (await import("./world-mocks")).scriptedProviderMock(orig as () => Promise<any>));

import { ProviderError } from "../../copilot/provider";
import { prepareOutreach } from "../../outbound/outreach-prepare";
import { addSuppression, approveMessage, cancelMessage, draftOutreach, editDraft, listMessages, listOutreachQueue, listSuppressions, markSent, openApproved, recordOutcome, removeSuppression, repairAfterSend } from "../../sales/outreach";
import { messageStore } from "../../sales/message-store";
import { updateLead } from "../../services/leads";
import { useWorld } from "./world-mocks";
import { createWorld, userRow, ORG1, ORG2, type World } from "./world";

const world = () => (globalThis as any).__world as World;
const OWNER = () => userRow() as any;
const OTHER_ORG = () => userRow({ id: "u2", organizationId: ORG2 }) as any;
/** Reads the pipeline (deals.edit) but may not change leads (no deals.create). */
const VIEWER = () => userRow({ id: "u3", orgRole: "CUSTOM", customPermissions: ["deals.edit"] }) as any;
const NOBODY = () => userRow({ id: "u4", orgRole: "CUSTOM", customPermissions: [] }) as any;
const NOW = new Date("2026-10-14T10:00:00Z");
const d = { now: () => NOW };
const code = (r: any) => (r.ok ? "ok" : r.code);

const BODY = "Hello,\n\nI saw on your website that you are hiring a Senior SEO Strategist for your SaaS team. Congratulations on the growth. I help agencies like yours keep client agreements and invoices tidy as the team grows, and I wondered whether that is on your mind right now.\n\nWould a short reply be useful?\n\nBest,\nAsha Rao";
let drafts = 0;
const model = (fail: (prompt: string) => Error | null = () => null) => {
  world().llm = async (m) => { drafts++; const e = fail(m.map((x) => x.content).join("\n")); if (e) throw e; return { content: JSON.stringify({ subject: "A quick note about your SEO hiring", body: BODY }), toolCalls: [], usage: { inputTokens: 900, outputTokens: 180 } }; };
};

let pid = 0, fid = 0;
/** A Ready prospect with evidence (a description and a dated hiring signal from its site) and a business email on its site. */
function prospect(over: Record<string, any> = {}, opts: { email?: string | null; personEmail?: string; orgId?: string } = {}) {
  const orgId = opts.orgId ?? ORG1;
  const p = {
    id: ++pid, organizationId: orgId, domain: `agency${pid}.com`, name: `Agency ${pid}`, website: `https://agency${pid}.com`, status: "ready", rejectReason: null, sources: [],
    profile: { industry: { value: "Digital marketing" } }, fit: { verdict: "strong", headline: "Fits", signals: [] }, score: null, angle: null, ready: true, contentHash: null,
    verifiedAt: new Date("2026-10-01T00:00:00Z"), researchedAt: new Date("2026-10-10T00:00:00Z"), leadId: null, createdAt: new Date("2026-10-02T00:00:00Z"), updatedAt: new Date("2026-10-10T00:00:00Z"), ...over,
  };
  world().outbound.prospects.push(p);
  const f = (x: Record<string, any>) => world().outbound.findings.push({ id: ++fid, organizationId: orgId, prospectId: p.id, kind: "fact", status: "confirmed", sourceUrl: `${p.website}/about`, sourceType: "website", quote: "Words quoted exactly from their own page.", contentHash: null, observedAt: null, confidence: "high", supportingIds: [], meta: {}, batch: "enrich", retrievedAt: NOW, ...x });
  f({ type: "description", value: "A digital marketing agency for SaaS companies" });
  f({ kind: "signal", type: "HIRING", value: "Hiring a Senior SEO Strategist", observedAt: new Date("2026-10-01T00:00:00Z"), meta: { datePrecision: "day" }, sourceUrl: `${p.website}/careers`, quote: "We are hiring a Senior SEO Strategist." });
  f({ kind: "decision_maker", type: "Founder", value: "Ana Silva, Founder and CEO", meta: { name: "Ana Silva", title: "Founder and CEO", rank: 1, email: opts.personEmail ?? null, emailStatus: opts.personEmail ? "verified" : null, provider: opts.personEmail ? "hunter" : undefined }, sourceType: opts.personEmail ? "provider" : "website" });
  if (opts.email !== null) f({ type: "business_email", value: opts.email ?? `hello@agency${p.id}.com` });
  return p;
}
const prepare = (ids: number[], u = OWNER()) => prepareOutreach(u, { prospectIds: ids }, d) as Promise<any>;
const drafted = async (ids: number[]) => { const r = await prepare(ids); expect(r.ok).toBe(true); return r.results; };
const sentMessage = async (p: { id: number }) => {
  const [r] = await drafted([p.id]);
  const m = world().messages.find((x) => x.id === r.messageId)!;
  expect(code(await approveMessage(OWNER(), m.id, m.bodyHash))).toBe("ok");
  expect(code(await markSent(OWNER(), m.id))).toBe("ok");
  return m;
};

beforeEach(() => { useWorld(createWorld()); pid = 0; fid = 0; drafts = 0; model(); vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { delete process.env.SALES_DAILY_DRAFT_LIMIT; expect(world().emails).toEqual([]); /* nothing is ever sent */ });

describe("preparing drafts for selected prospects", () => {
  it("adds each Ready prospect to Leads and writes one draft for review; nothing is approved or sent", async () => {
    const a = prospect(), b = prospect({}, { personEmail: "ana@agency2.com" });
    const res = await drafted([a.id, b.id]);
    expect(res.map((r: any) => r.outcome)).toEqual(["drafted", "drafted"]);
    expect(world().messages.map((m) => [m.status, m.toAddress, m.toSource])).toEqual([["draft", "hello@agency1.com", "site"], ["draft", "ana@agency2.com", "lead"]]);
    expect(world().outbound.prospects.every((p) => p.leadId)).toBe(true);
  });
  it("skips what isn't eligible, with the reason, and drafts the rest", async () => {
    const ok = prospect();
    const notReady = prospect({ ready: false, status: "qualified" });
    const noEmail = prospect({}, { email: null });
    const setAside = prospect({ status: "rejected", rejectReason: "parked_domain", ready: false });
    const res = await drafted([ok.id, notReady.id, noEmail.id, setAside.id, 99999]);
    expect(res.map((r: any) => [r.outcome, r.reason ?? null])).toEqual([["drafted", null], ["skipped", "not_ready"], ["skipped", "no_email"], ["skipped", "set_aside"], ["skipped", "not_found"]]);
    expect(world().messages).toHaveLength(1);
  });
  it("never makes a second draft: preparing again skips, and one request at a time per person", async () => {
    const a = prospect();
    await drafted([a.id]);
    expect((await drafted([a.id]))[0]).toMatchObject({ outcome: "skipped", reason: "draft_exists" });
    expect(world().messages).toHaveLength(1);
    const [x, y] = await Promise.all([prepare([prospect().id]), prepare([prospect().id])]);
    expect([code(x), code(y)].sort()).toEqual(["ok", "prepare_in_progress"]);
  });
  it("is bounded: more than 10 prospects is refused", async () => {
    expect(await prepare(Array.from({ length: 11 }, (_, i) => i + 1))).toMatchObject({ ok: false, status: 400 });
  });
  it("a model failure fails that prospect only; a used-up allowance stops the rest, saying so", async () => {
    model((prompt) => (prompt.includes("Agency 2") ? new ProviderError("upstream", "busy") : null)); // the model fails for the 2nd prospect only
    const [a, b, c] = [prospect(), prospect(), prospect()];
    const res = await drafted([a.id, b.id, c.id]);
    expect(res.map((r: any) => r.outcome)).toEqual(["drafted", "failed", "drafted"]);
    expect(res[1].message).not.toMatch(/busy|upstream|Error/); // a safe message, not the provider's
    process.env.SALES_DAILY_DRAFT_LIMIT = String(world().llmCalls.filter((c) => c.task === "draft" && c.ok).length);
    const [e, f] = [prospect(), prospect()];
    expect((await drafted([e.id, f.id])).map((r: any) => r.reason)).toEqual(["daily_limit", "daily_limit"]);
  });
});

describe("approval is required, once, for exactly the text read", () => {
  it("nothing is recorded as sent before approval; an outcome needs a sent message", async () => {
    const [r] = await drafted([prospect().id]);
    expect(code(await markSent(OWNER(), r.messageId))).toBe("not_approved");
    expect(code(await recordOutcome(OWNER(), r.messageId, { outcome: "replied" }))).toBe("not_sent");
  });
  it("double clicks on send and on an outcome take effect once", async () => {
    const [r] = await drafted([prospect().id]);
    const m = world().messages.find((x) => x.id === r.messageId)!;
    await approveMessage(OWNER(), m.id, m.bodyHash);
    const [s1, s2] = await Promise.all([markSent(OWNER(), m.id), markSent(OWNER(), m.id)]);
    expect([(s1 as any).already, (s2 as any).already].sort()).toEqual([false, true]);
    expect(world().outreachEvents.filter((e) => e.kind === "sent")).toHaveLength(1);
    const [o1, o2] = await Promise.all([recordOutcome(OWNER(), m.id, { outcome: "replied" }), recordOutcome(OWNER(), m.id, { outcome: "replied" })]);
    expect([(o1 as any).already, (o2 as any).already].sort()).toEqual([false, true]);
    expect(world().outreachEvents.filter((e) => e.kind === "replied")).toHaveLength(1);
    expect(world().leads.leads.find((l) => l.id === m.leadId)!.status).toBe("replied");
  });
});

describe("opt-outs, bounces and the do-not-contact list", () => {
  it("an opt-out lists the address, marks the lead do-not-contact, and protects the address on every other lead", async () => {
    const shared = "team@shared-agency.com";
    const m = await sentMessage(prospect({}, { email: shared }));
    const other = prospect({ domain: "shared-agency.com" }, { email: shared });
    expect(await recordOutcome(OWNER(), m.id, { outcome: "opted_out" })).toMatchObject({ ok: true, suppressed: true });
    expect(world().suppressions).toMatchObject([{ kind: "email", value: shared, reason: "opt_out", sourceMessageId: m.id }]);
    expect(world().leads.leads.find((l) => l.id === m.leadId)!.doNotContact).toBe(true);
    expect((await drafted([other.id]))[0]).toMatchObject({ outcome: "skipped", reason: "suppressed" });
    expect(world().leads.events.some((e) => e.kind === "outreach_opted_out")).toBe(true);
  });
  it("listing an address or domain cancels anything unsent to it; later approval or send is refused", async () => {
    const [a] = await drafted([prospect({}, { email: "hi@blocked.com" }).id]);
    const [b] = await drafted([prospect().id]);
    const mb = world().messages.find((x) => x.id === b.messageId)!;
    await approveMessage(OWNER(), mb.id, mb.bodyHash);
    expect(await addSuppression(OWNER(), { value: "@blocked.com" }, d)).toMatchObject({ ok: true, cancelled: 1, entry: { kind: "domain", value: "blocked.com", removable: true } });
    expect(world().messages.find((x) => x.id === a.messageId)!.status).toBe("cancelled");
    // an entry that arrived without the cancel (another server, a race): approval and send still check
    world().suppressions.push({ id: 99, organizationId: ORG1, kind: "email", value: mb.toAddress, reason: "manual", createdAt: NOW });
    expect(code(await markSent(OWNER(), mb.id))).toBe("suppressed");
    const [c] = await drafted([prospect().id]);
    const mc = world().messages.find((x) => x.id === c.messageId)!;
    world().suppressions.push({ id: 100, organizationId: ORG1, kind: "email", value: mc.toAddress, reason: "manual", createdAt: NOW });
    expect(code(await approveMessage(OWNER(), mc.id, mc.bodyHash))).toBe("suppressed");
  });
  it("a bounce lists the address; opt-outs and bounces can't be removed, hand-made entries can", async () => {
    const m = await sentMessage(prospect());
    await recordOutcome(OWNER(), m.id, { outcome: "bounced" });
    const list = await listSuppressions(OWNER()) as any;
    expect(list.entries).toMatchObject([{ reason: "bounce", removable: false }]);
    expect(code(await removeSuppression(OWNER(), list.entries[0].id))).toBe("not_removable");
    const manual = await addSuppression(OWNER(), { value: "someone@else.com" }) as any;
    expect(code(await removeSuppression(OWNER(), manual.entry.id))).toBe("ok");
    expect(code(await addSuppression(OWNER(), { value: "not an address" }))).toBe("invalid");
  });
  it("if the list exists but can't be read, nothing is drafted, approved or sent (fail closed)", async () => {
    const [r] = await drafted([prospect().id]);
    const m = world().messages.find((x) => x.id === r.messageId)!;
    world().outreachSafetyFail = true;
    expect(code(await approveMessage(OWNER(), m.id, m.bodyHash))).toBe("suppression_unavailable");
    expect((await drafted([prospect().id]))[0]).toMatchObject({ outcome: "failed", reason: "suppression_unavailable" });
  });
  it("before the list's migration, outreach works as before and the new actions say they aren't set up", async () => {
    world().outreachSafetyReady = false;
    const m = await sentMessage(prospect());
    expect(code(await recordOutcome(OWNER(), m.id, { outcome: "opted_out" }))).toBe("OUTREACH_SAFETY_NOT_SETUP");
    expect(code(await addSuppression(OWNER(), { value: "a@b.com" }))).toBe("OUTREACH_SAFETY_NOT_SETUP");
  });
});

describe("permissions and organizations", () => {
  it("only people who may change leads prepare, record outcomes or change the list; readers see the queue", async () => {
    const m = await sentMessage(prospect());
    expect(code(await prepare([prospect().id], VIEWER()))).toBe("forbidden");
    expect(code(await recordOutcome(VIEWER(), m.id, { outcome: "opted_out" }))).toBe("forbidden");
    expect(code(await addSuppression(VIEWER(), { value: "a@b.com" }))).toBe("forbidden");
    expect(code(await listOutreachQueue(VIEWER()))).toBe("ok");
    expect(code(await listOutreachQueue(NOBODY()))).toBe("forbidden");
  });
  it("another organization sees none of it and can't act on it; each organization has its own list", async () => {
    const m = await sentMessage(prospect({}, { email: "ceo@target.com" }));
    await recordOutcome(OWNER(), m.id, { outcome: "opted_out" });
    expect((await listOutreachQueue(OTHER_ORG()) as any).items).toEqual([]);
    expect(code(await recordOutcome(OTHER_ORG(), m.id, { outcome: "replied" }))).toBe("not_found");
    expect(code(await removeSuppression(OTHER_ORG(), world().suppressions[0].id))).toBe("not_removable");
    expect((await listSuppressions(OTHER_ORG()) as any).entries).toEqual([]);
    // ORG2's own prospect at the same address is not blocked by ORG1's list; ORG1's prospect ids are not ORG2's
    const theirs = prospect({}, { email: "ceo@target.com", orgId: ORG2 });
    const r = await prepareOutreach(OTHER_ORG(), { prospectIds: [theirs.id, 1] }, d) as any;
    expect(r.results.map((x: any) => [x.outcome, x.reason ?? null])).toEqual([["drafted", null], ["skipped", "not_found"]]);
  });
});

describe("the review queue shows the evidence and where the address came from", () => {
  it("each draft with the facts it was written from (with their sources) and the address's provenance", async () => {
    await drafted([prospect({}, { personEmail: "ana@agency1.com" }).id]);
    const q = await listOutreachQueue(OWNER()) as any;
    expect(q.items).toHaveLength(1);
    const it0 = q.items[0];
    expect(it0.recipient).toMatchObject({ address: "ana@agency1.com", source: "lead" });
    expect(it0.recipient.detail).toMatch(/hunter \(verified\)/);
    expect(it0.evidence.length).toBeGreaterThan(0);
    expect(it0.evidence.every((e: any) => e.status === "confirmed" && /^https:\/\/agency1\.com\//.test(e.url) && e.quote)).toBe(true);
    expect(it0).toMatchObject({ suppressed: false, outcomes: [], message: { status: "draft" } });
  });
});

describe("the lead's own do-not-contact flag, whenever it is set", () => {
  /** A drafted message for a fresh Ready prospect, and its lead. */
  const one = async (orgUser = OWNER(), opts: { orgId?: string } = {}) => {
    const p = prospect({}, { orgId: opts.orgId });
    const r = await prepareOutreach(orgUser, { prospectIds: [p.id] }, d) as any;
    expect(r.results[0].outcome).toBe("drafted");
    const m = () => world().messages.find((x) => x.id === r.results[0].messageId)!;
    return { m, leadId: r.results[0].leadId as number };
  };
  const status = (id: number) => world().messages.find((x) => x.id === id)!.status;
  const dnc = (leadId: number, on = true, u = OWNER()) => updateLead(u, leadId, { doNotContact: on });

  it("opening hands over exactly the approved text, after the checks, and records it once; nothing is sent", async () => {
    const { m } = await one();
    expect(code(await openApproved(OWNER(), m().id, m().bodyHash))).toBe("not_approved"); // a draft can't be opened
    await approveMessage(OWNER(), m().id, m().bodyHash);
    expect(await openApproved(OWNER(), m().id, m().bodyHash)).toMatchObject({ ok: true, to: m().toAddress, subject: m().subject, body: m().body });
    await openApproved(OWNER(), m().id, m().bodyHash);
    expect(world().outreachEvents.filter((e) => e.kind === "opened")).toHaveLength(1);
    expect(status(m().id)).toBe("approved"); // opening is not sending
    expect((await listOutreachQueue(OWNER()) as any).items.find((i: any) => i.message.id === m().id).outcomes).toEqual([]); // an audit entry, not an outcome
  });

  it("marked BEFORE approval: the draft is discarded, and it can't be approved, opened or recorded as sent", async () => {
    const { m, leadId } = await one();
    const { id, bodyHash } = m();
    expect(code(await dnc(leadId))).toBe("ok");
    expect(status(id)).toBe("cancelled");
    expect(world().leads.events.some((e) => e.leadId === leadId && e.kind === "draft_cancelled" && e.data?.why === "do_not_contact")).toBe(true);
    expect(code(await approveMessage(OWNER(), id, bodyHash))).toBe("do_not_contact");
    expect(code(await openApproved(OWNER(), id, bodyHash))).toBe("not_approved");
    expect(code(await markSent(OWNER(), id))).toBe("not_approved");
    expect(code(await draftOutreach(OWNER(), leadId))).toBe("do_not_contact"); // and no new draft
  });

  it("marked AFTER approval: the approved message is discarded; opening or recording a send is refused", async () => {
    const { m, leadId } = await one();
    const { id, bodyHash } = m();
    await approveMessage(OWNER(), id, bodyHash);
    await dnc(leadId);
    expect(status(id)).toBe("cancelled");
    expect(code(await openApproved(OWNER(), id, bodyHash))).toBe("not_approved");
    expect(code(await markSent(OWNER(), id))).toBe("not_approved");
    expect(world().outreachEvents.filter((e) => e.kind === "sent")).toHaveLength(0);
  });

  it("even if discarding failed (another server, a crash): the flag itself stops opening and recording a send", async () => {
    const { m, leadId } = await one();
    const { id, bodyHash } = m();
    await approveMessage(OWNER(), id, bodyHash);
    world().leads.leads.find((l) => l.id === leadId)!.doNotContact = true; // set without the discard
    expect(status(id)).toBe("approved");
    expect(code(await openApproved(OWNER(), id, bodyHash))).toBe("do_not_contact");
    expect(code(await markSent(OWNER(), id))).toBe("do_not_contact");
  });

  it("a stale approval stays unusable after the flag is lifted: a new draft and a new approval are needed", async () => {
    const { m, leadId } = await one();
    const old = { ...m() };
    await approveMessage(OWNER(), old.id, old.bodyHash);
    await dnc(leadId);
    await dnc(leadId, false);
    expect(status(old.id)).toBe("cancelled");
    expect(code(await openApproved(OWNER(), old.id, old.bodyHash))).toBe("not_approved");
    expect(code(await markSent(OWNER(), old.id))).toBe("not_approved");
    const fresh = await draftOutreach(OWNER(), leadId) as any;
    expect(fresh).toMatchObject({ ok: true, message: { status: "draft" } });
    expect(code(await openApproved(OWNER(), fresh.message.id, fresh.message.bodyHash))).toBe("not_approved");
  });

  it("a stale page can't open text other than the approved text; the list still applies when opening", async () => {
    const { m } = await one();
    const before = m().bodyHash;
    await editDraft(OWNER(), m().id, { subject: m().subject, body: `${m().body}\n\nP.S. One more thing.` });
    await approveMessage(OWNER(), m().id, m().bodyHash);
    expect(code(await openApproved(OWNER(), m().id, before))).toBe("changed");
    world().suppressions.push({ id: 1, organizationId: ORG1, kind: "email", value: m().toAddress, reason: "manual", createdAt: NOW });
    expect(code(await openApproved(OWNER(), m().id, m().bodyHash))).toBe("suppressed");
  });

  it("organizations and permissions: no one else opens it, flags it, or is affected by another's flag", async () => {
    const mine = await one();
    await approveMessage(OWNER(), mine.m().id, mine.m().bodyHash);
    const theirs = await one(OTHER_ORG(), { orgId: ORG2 });
    await approveMessage(OTHER_ORG(), theirs.m().id, theirs.m().bodyHash);
    expect(code(await openApproved(OTHER_ORG(), mine.m().id, mine.m().bodyHash))).toBe("not_found");
    expect(code(await dnc(mine.leadId, true, OTHER_ORG()))).toBe("not_found");
    expect(status(mine.m().id)).toBe("approved");
    await dnc(theirs.leadId, true, OTHER_ORG()); // ORG2 flags its own lead
    expect(status(theirs.m().id)).toBe("cancelled");
    expect(status(mine.m().id)).toBe("approved"); // ORG1 untouched
    expect(code(await openApproved(VIEWER(), mine.m().id, mine.m().bodyHash))).toBe("forbidden");
    expect(code(await dnc(mine.leadId, true, VIEWER()))).toBe("forbidden");
  });
});

describe("recording a send: the locked decision has the last word", () => {
  /** An approved message whose quick pre-checks pass, with a store whose locked check answers `answer` (the race). */
  const racing = async (answer: any) => {
    const p = prospect();
    const r = await prepareOutreach(OWNER(), { prospectIds: [p.id] }, d) as any;
    const m = world().messages.find((x) => x.id === r.results[0].messageId)!;
    await approveMessage(OWNER(), m.id, m.bodyHash);
    const { messageStore } = await import("../../sales/message-store");
    const store = { ...messageStore, recordSentIfAllowed: async () => answer };
    return { m, res: await markSent(OWNER(), m.id, { store: store as any }) as any };
  };
  it("flagged or listed in the instant before the send: refused with the same plain reasons, nothing recorded", async () => {
    const a = await racing({ result: "do_not_contact" });
    expect(a.res).toMatchObject({ ok: false, status: 409, code: "do_not_contact" });
    const b = await racing({ result: "suppressed", entry: { kind: "domain", value: "agency2.com", reason: "manual" } });
    expect(b.res).toMatchObject({ ok: false, code: "suppressed" });
    expect(b.res.message).toMatch(/Everyone at agency2\.com is on your do-not-contact list/);
    expect(world().outreachEvents.filter((e) => e.kind === "sent")).toHaveLength(0);
    expect(world().leads.events.filter((e) => e.kind === "message_sent")).toHaveLength(0);
  });
  it("discarded in that instant: a plain 'discarded' refusal; a lost double click is 'already sent'", async () => {
    const a = await racing({ result: "not_approved", row: { status: "cancelled" } });
    expect(a.res).toMatchObject({ ok: false, code: "not_approved" });
    expect(a.res.message).toMatch(/discarded, so it can't be recorded as sent/);
    const b = await racing({ result: "not_approved", row: { ...{ id: 1, leadId: 1, status: "sent", subject: "s", body: "b", bodyHash: "h", toAddress: "a@b.co", toSource: "site", edited: false, createdBy: "user", createdAt: NOW, approvedAt: NOW, sentAt: NOW } } });
    expect(b.res).toMatchObject({ ok: true, already: true });
  });
  it("the lead page's toggle: switching it on reports how many unsent messages it discarded", async () => {
    const p = prospect();
    const r = await prepareOutreach(OWNER(), { prospectIds: [p.id] }, d) as any;
    expect(await updateLead(OWNER(), r.results[0].leadId, { doNotContact: true })).toMatchObject({ ok: true, discarded: 1 });
    expect(await updateLead(OWNER(), r.results[0].leadId, { doNotContact: false })).not.toHaveProperty("discarded");
  });
});

describe("a message being sent from the connected mailbox (status \"sending\", set by the Gmail reservation)", () => {
  /** An approved message that the Gmail pipeline has reserved: in flight, or uncertain until a person settles it. */
  const reserved = async () => {
    const p = prospect();
    const [r] = await drafted([p.id]);
    const m = world().messages.find((x) => x.id === r.messageId)!;
    expect(code(await approveMessage(OWNER(), m.id, m.bodyHash))).toBe("ok");
    m.status = "sending";
    return m;
  };

  it("no competing path can send, hand over, change or discard it: 'I sent it', open in my email app, edit, cancel", async () => {
    const m = await reserved();
    for (const [name, r] of [
      ["record as sent", await markSent(OWNER(), m.id)],
      ["open in email app", await openApproved(OWNER(), m.id, m.bodyHash)],
      ["edit", await editDraft(OWNER(), m.id, { subject: "Other", body: BODY })],
      ["cancel", await cancelMessage(OWNER(), m.id)],
    ] as const) {
      expect(r, name).toMatchObject({ ok: false, code: "sending" });
      expect((r as any).message, name).toMatch(/being sent from Gmail, or waiting for you to confirm/);
    }
    expect(m.status).toBe("sending");
    expect(world().outreachEvents.filter((e) => e.messageId === m.id && (e.kind === "sent" || e.kind === "opened"))).toHaveLength(0);
    expect(world().leads.events.filter((e) => e.kind === "message_sent")).toHaveLength(0);
  });

  it("marking the lead do-not-contact or listing its address doesn't silently rewrite it, and no second first message can be drafted", async () => {
    const m = await reserved();
    expect(await updateLead(OWNER(), m.leadId, { doNotContact: true })).toMatchObject({ ok: true, discarded: 0 });
    expect(m.status).toBe("sending"); // the Gmail pipeline settles it (and discards it then, if the lead is do-not-contact)
    await updateLead(OWNER(), m.leadId, { doNotContact: false });
    expect(code(await draftOutreach(OWNER(), m.leadId, {}, d))).toBe("sending");
    expect((await addSuppression(OWNER(), { value: m.toAddress! }) as any).cancelled).toBe(0);
    expect(m.status).toBe("sending");
  });

  it("it stays visible in the review queue while it is in flight or uncertain", async () => {
    const m = await reserved();
    const q = await listOutreachQueue(OWNER(), {}) as any;
    expect(q.items.map((i: any) => [i.message.id, i.message.status])).toContainEqual([m.id, "sending"]);
    expect((await listOutreachQueue(OWNER(), { status: "waiting" }) as any).items.some((i: any) => i.message.id === m.id)).toBe(true);
  });
});

describe("the follow-up after a send is durable: recorded with the send, done once", () => {
  const approvedMessage = async () => {
    const p = prospect();
    const [r] = await drafted([p.id]);
    const m = world().messages.find((x) => x.id === r.messageId)!;
    expect(code(await approveMessage(OWNER(), m.id, m.bodyHash))).toBe("ok");
    return m;
  };
  const followUps = (leadId: number) => world().leads.tickets.filter((t) => t.leadId === leadId && t.kind === "follow_up");
  const marks = (id: number) => world().outreachEvents.filter((e) => e.messageId === id).map((e) => e.kind);

  it("'I sent it' records the send and its outbox entry together, then the follow-up once (repeats add nothing)", async () => {
    const m = await approvedMessage();
    expect(await markSent(OWNER(), m.id)).toMatchObject({ ok: true, movedTo: "contacted" });
    expect(marks(m.id)).toEqual(["sent", "follow_due", "follow_done"]);
    expect(followUps(m.leadId)).toHaveLength(1);
    expect(await markSent(OWNER(), m.id)).toMatchObject({ ok: true, already: true });
    expect(await repairAfterSend(ORG1)).toBe(0);
    expect(followUps(m.leadId)).toHaveLength(1);
  });

  it("the follow-up failing after the send was recorded: the send stands, and the next look at the queue finishes it, once", async () => {
    const m = await approvedMessage();
    const broken = { store: { ...messageStore, completeAfterSend: async () => { throw new Error("connection reset"); } } as any };
    expect(await markSent(OWNER(), m.id, broken)).toMatchObject({ ok: true, movedTo: null });
    expect(m.status).toBe("sent");
    expect(marks(m.id)).toEqual(["sent", "follow_due"]);
    expect(followUps(m.leadId)).toHaveLength(0);
    expect(code(await listOutreachQueue(OWNER(), {}))).toBe("ok"); // the repair pass runs on the way
    expect(followUps(m.leadId)).toHaveLength(1);
    expect(marks(m.id)).toEqual(["sent", "follow_due", "follow_done"]);
    expect(code(await listMessages(OWNER(), m.leadId))).toBe("ok");
    expect(await repairAfterSend(undefined)).toBe(0);
    expect(followUps(m.leadId)).toHaveLength(1);
  });

  it("before the outcome tables exist there is no outbox: the follow-up is best effort, as it was", async () => {
    const m = await approvedMessage();
    world().outreachSafetyReady = false;
    expect(await markSent(OWNER(), m.id)).toMatchObject({ ok: true, movedTo: "contacted" });
    expect(marks(m.id)).toEqual([]);
    expect(followUps(m.leadId)).toHaveLength(1);
  });
});
