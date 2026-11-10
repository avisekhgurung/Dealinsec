/**
 * Message versions (draft variants), end to end in the in-memory world: up to three versions written one strategy
 * each, the person choosing one, and every safety rule holding across the batch — one unsent message per lead,
 * approval-by-hash untouched, do-not-contact and the list discarding pending versions, one batch = ONE AI draft.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", async () => (await import("./world-mocks")).storageMock());
vi.mock("../../entitlements", async () => (await import("./world-mocks")).entitlementsMock());
vi.mock("../../emails", async () => (await import("./world-mocks")).emailsMock());
vi.mock("../../leads/profile-store", async () => (await import("./world-mocks")).profileStoreMock());
vi.mock("../../discovery/provider", async () => (await import("./world-mocks")).discoveryProviderMock());
vi.mock("../../documents/style-store", async () => (await import("./world-mocks")).documentStyleStoreMock());
vi.mock("../../knowledge/store", async () => (await import("./world-mocks")).knowledgeStoreMock());
vi.mock("../../knowledge/net-guard", async (orig) => (await import("./world-mocks")).netGuardMock(orig as () => Promise<any>));
vi.mock("../../leads/store", async () => (await import("./world-mocks")).leadsStoreMock());
vi.mock("../../sales/research-store", async () => (await import("./world-mocks")).researchStoreMock());
vi.mock("../../sales/message-store", async () => (await import("./world-mocks")).messageStoreMock());
vi.mock("../../llm/trace-store", async () => (await import("./world-mocks")).traceStoreMock());
vi.mock("../../routes", async () => (await import("./world-mocks")).routesMock());
vi.mock("../../copilot/provider", async (orig) => (await import("./world-mocks")).scriptedProviderMock(orig as () => Promise<any>));

import { approveMessage, cancelMessage, chooseVariant, draftOutreach, draftOutreachVariants, editDraft, hashDraft, listMessages, markSent } from "../../sales/outreach";
import { addClaim, updateLead } from "../../services/leads";
import { useWorld } from "./world-mocks";
import { createWorld, seedLead, seedProfile, userRow, ORG1, type World } from "./world";

const world = () => (globalThis as any).__world as World;
const user = (over: Record<string, any> = {}) => userRow(over) as any;

const SUBJECT = "A quick note about Casa Alma Porto";
const BODY = "Hello,\n\nI saw that Casa Alma runs boutique hotels in Lisbon and has just opened a second hotel in Porto. Congratulations. I help small hotel groups keep their client paperwork tidy, and I wondered whether that is something you are thinking about as you grow.\n\nWould a short reply or a quick chat be useful?\n\nBest,\nAsha Rao";
const BODY2 = BODY.replace("Congratulations.", "Impressive.");
const BODY3 = BODY.replace("Congratulations.", "Well done.");
const PRICED = BODY.replace("Congratulations.", "It would cost $500.");
let prompts: { role: string; content: string }[][] = [];
const asJson = (subject: string, body: string) => JSON.stringify({ subject, body });
/** Each model call answers the next text in the script (the last one repeats). */
const script = (...texts: string[]) => { let i = 0; world().llm = async (m) => { prompts.push(m); return { content: texts[Math.min(i++, texts.length - 1)], toolCalls: [], usage: { inputTokens: 900, outputTokens: 180 } }; }; };
const threeGood = () => script(asJson(SUBJECT, BODY), asJson(SUBJECT, BODY2), asJson(SUBJECT, BODY3));

const lead = (over: Record<string, any> = {}) => seedLead(world(), { companyName: "Casa Alma", website: "https://casaalma.pt", domain: "casaalma.pt", industry: "Boutique hotels", location: "Lisbon, Portugal", ...over });
const claim = (leadId: number, field: string, value: string, status = "confirmed") =>
  addClaim(user(), leadId, { field, value, status, ...(status === "confirmed" ? { evidenceUrl: "https://casaalma.pt/about", evidenceSnippet: `${value} (as written on the page)` } : {}) }, { actor: "agent" });
/** A researched lead whose evidence grounds three ways to open: a launch (trigger), a possible problem, and direct. */
const researched = async (over: Record<string, any> = {}) => {
  const l = lead(over);
  await claim(l.id, "description", "Runs boutique hotels in Lisbon");
  await claim(l.id, "launch", "Opened a second hotel, Casa Alma Porto");
  await claim(l.id, "business_email", "hello@casaalma.pt");
  await claim(l.id, "pain_point", "Bookings are taken by phone only", "inferred");
  world().research.push({ id: world().research.length + 1, leadId: l.id, organizationId: ORG1, status: "done", startedAt: new Date(), claimIds: [] });
  return l;
};
const variants = async (id: number, u = user()) => { const r = await draftOutreachVariants(u, id); if (!r.ok) throw new Error(`${r.code}: ${r.message}`); return r; };
const rows = () => world().messages;
const events = (leadId: number, kind: string) => world().leads.events.filter((e) => e.leadId === leadId && e.kind === kind);
const code = (r: any) => (r.ok ? "ok" : r.code);

beforeEach(() => { useWorld(createWorld()); seedProfile(world(), { about: "I help small hotel groups keep their client paperwork tidy." }); prompts = []; threeGood(); vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { delete process.env.SALES_DAILY_DRAFT_LIMIT; delete process.env.OUTBOUND_MONTHLY_DRAFTS_PRO; });

describe("writing the versions", () => {
  it("writes one version per grounded strategy, strongest first, each traced under its own prompt version", async () => {
    const l = await researched();
    const r = await variants(l.id);
    expect(r.variants).toHaveLength(3);
    expect(r.variants.map((v) => v.strategy)).toEqual(["trigger", "problem", "direct"]);
    expect(r.variants.every((v) => v.status === "variant")).toBe(true);
    expect(new Set(r.variants.map((v) => v.variantGroup)).size).toBe(1);
    expect(r.variants[0].variantGroup).toBeTruthy();
    expect(r.variants.map((v) => v.body)).toEqual([BODY, BODY2, BODY3]); // genuinely separate calls, one per strategy
    expect(world().llmCalls.map((c: any) => c.promptVersion)).toEqual(["draft-v7:trigger", "draft-v7:problem", "draft-v7:direct"]);
    expect(rows()).toHaveLength(3);
    expect(world().leads.leads.find((x: any) => x.id === l.id)!.status).toBe("new"); // writing versions changes no stage
  });
  it("the timeline records the batch (ids, counts, strategies), never the message text", async () => {
    const l = await researched();
    await variants(l.id);
    const e = events(l.id, "variants_created");
    expect(e).toHaveLength(1);
    expect(e[0].data).toMatchObject({ count: 3, strategies: ["trigger", "problem", "direct"], claims: 3 });
    expect(JSON.stringify(world().leads.events)).not.toContain("quick note");
  });
  it("each version carries its own strategy's opening instruction, and the same facts", async () => {
    const l = await researched();
    await variants(l.id);
    expect(prompts).toHaveLength(3);
    expect(prompts[0][0].content).toMatch(/most recent thing that happened/);
    expect(prompts[1][0].content).toMatch(/possible problem/);
    expect(prompts[2][0].content).toMatch(/plain, honest introduction/);
    for (const p of prompts) expect(p[1].content).toContain("Opened a second hotel");
  });
  it("a version that fails the checks (even after its retry) is dropped; the others are kept", async () => {
    const l = await researched();
    script(asJson(SUBJECT, BODY), asJson(SUBJECT, PRICED), asJson(SUBJECT, PRICED), asJson(SUBJECT, BODY3));
    const r = await variants(l.id);
    expect(r.retried).toBe(true);
    expect(r.variants.map((v) => v.strategy)).toEqual(["trigger", "direct"]);
    expect(rows()).toHaveLength(2);
    expect(rows().every((m: any) => !m.body.includes("$500"))).toBe(true); // the priced one was never stored
  });
  it("when every version fails, nothing is stored and the refusal names the issues", async () => {
    const l = await researched();
    script(asJson(SUBJECT, PRICED));
    const r = await draftOutreachVariants(user(), l.id) as any;
    expect(r).toMatchObject({ ok: false, code: "draft_rejected", issues: ["price"] });
    expect(rows()).toHaveLength(0);
    expect(events(l.id, "variants_created")).toHaveLength(0);
  });
  it("when only one way is grounded, or only one version survives, it is stored as THE draft directly", async () => {
    const plain = lead({ companyName: "Guess Co", domain: "guess.pt", website: "https://guess.pt", contactEmail: "info@guess.pt" });
    await claim(plain.id, "description", "Runs a small guesthouse"); // nothing dated, no problem, no opportunity: direct only
    const one = await variants(plain.id);
    expect(one.variants).toHaveLength(1);
    expect(one.variants[0]).toMatchObject({ status: "draft", strategy: "direct", variantGroup: null });

    const l = await researched();
    script(asJson(SUBJECT, BODY), asJson(SUBJECT, PRICED), asJson(SUBJECT, PRICED), asJson(SUBJECT, PRICED), asJson(SUBJECT, PRICED));
    const survived = await variants(l.id);
    expect(survived.variants).toHaveLength(1);
    expect(survived.variants[0]).toMatchObject({ status: "draft", strategy: "trigger", variantGroup: null });
  });
  it("the versions hold the lead's one message slot: no second draft and no second batch beside them", async () => {
    const l = await researched();
    const first = await variants(l.id);
    expect(code(await draftOutreach(user(), l.id))).toBe("draft_exists");
    const again = await draftOutreachVariants(user(), l.id) as any;
    expect(again).toMatchObject({ ok: false, code: "draft_exists", messageId: first.variants[0].id });
    expect(prompts).toHaveLength(3); // the refusals paid for no model call
  });
  it("an existing draft blocks a batch the same way", async () => {
    const l = await researched();
    await draftOutreach(user(), l.id);
    expect(code(await draftOutreachVariants(user(), l.id))).toBe("draft_exists");
  });
  it("every refusal a single draft gives holds for versions too, before any model call", async () => {
    const noAddress = lead({ companyName: "No Mail", domain: "nomail.pt", website: "https://nomail.pt" });
    await claim(noAddress.id, "description", "Runs hotels");
    expect(code(await draftOutreachVariants(user(), noAddress.id))).toBe("no_address");
    const dnc = await researched({ companyName: "Flagged", domain: "flagged.pt", website: "https://flagged.pt", contactEmail: "x@flagged.pt" });
    await updateLead(user(), dnc.id, { doNotContact: true }, { actor: "user" });
    expect(code(await draftOutreachVariants(user(), dnc.id))).toBe("do_not_contact");
    expect(prompts).toHaveLength(0);
  });
});

describe("one batch is ONE AI draft against the allowance", () => {
  it("a three-version batch uses one, so a second lead still gets its draft", async () => {
    process.env.OUTBOUND_MONTHLY_DRAFTS_PRO = "2";
    const l1 = await researched();
    await variants(l1.id);
    const l2 = await researched({ companyName: "Casa Dois", website: "https://c2.pt", domain: "c2.pt", contactEmail: "oi@c2.pt" });
    expect(code(await draftOutreach(user(), l2.id))).toBe("ok");
    const l3 = await researched({ companyName: "Casa Tres", website: "https://c3.pt", domain: "c3.pt", contactEmail: "oi@c3.pt" });
    expect(code(await draftOutreach(user(), l3.id))).toBe("draft_allowance");
    expect(code(await draftOutreachVariants(user(), l3.id))).toBe("draft_allowance");
  });
  it("the allowance refusal comes before any model call is paid for", async () => {
    process.env.OUTBOUND_MONTHLY_DRAFTS_PRO = "1";
    const l1 = await researched();
    await variants(l1.id);
    const calls = prompts.length;
    const l2 = await researched({ companyName: "Casa Dois", website: "https://c2.pt", domain: "c2.pt", contactEmail: "oi@c2.pt" });
    expect(code(await draftOutreachVariants(user(), l2.id))).toBe("draft_allowance");
    expect(prompts.length).toBe(calls);
  });
  it("each version's model call still counts against the daily draft cap", async () => {
    process.env.SALES_DAILY_DRAFT_LIMIT = "2";
    const l = await researched();
    const r = await variants(l.id); // the third call hits the cap: what passed so far is kept
    expect(r.variants.map((v) => v.strategy)).toEqual(["trigger", "problem"]);
    expect(rows()).toHaveLength(2);
  });
  it("a cap already used up is the plain cap refusal, before any model call, and nothing is stored", async () => {
    process.env.SALES_DAILY_DRAFT_LIMIT = "1";
    const l1 = await researched();
    await draftOutreach(user(), l1.id); // the day's one call
    const calls = prompts.length;
    const l2 = await researched({ companyName: "Casa Dois", website: "https://c2.pt", domain: "c2.pt", contactEmail: "oi@c2.pt" });
    expect(code(await draftOutreachVariants(user(), l2.id))).toBe("daily_limit");
    expect(prompts.length).toBe(calls);
    expect(rows().filter((m: any) => m.leadId === l2.id)).toHaveLength(0);
  });
});

describe("choosing a version", () => {
  it("the chosen version becomes THE draft, its siblings are discarded, and the usual approve-and-send flow follows", async () => {
    const l = await researched();
    const { variants: vs } = await variants(l.id);
    const pick = vs[1];
    const r = await chooseVariant(user(), pick.id, pick.bodyHash) as any;
    expect(r).toMatchObject({ ok: true, already: false, message: { id: pick.id, status: "draft", strategy: "problem" } });
    expect(rows().filter((m: any) => m.status === "cancelled")).toHaveLength(2);
    expect(events(l.id, "variant_chosen")[0].data).toEqual({ messageId: pick.id, strategy: "problem" });
    // From here it is the one flow there has ever been: approve exactly what was read, then record the send.
    const ap = await approveMessage(user(), pick.id, pick.bodyHash) as any;
    expect(ap).toMatchObject({ ok: true, message: { status: "approved" } });
    expect((await markSent(user(), pick.id) as any).message.status).toBe("sent");
  });
  it("choosing is of ONE exact text: a wrong hash is refused", async () => {
    const l = await researched();
    const { variants: vs } = await variants(l.id);
    expect(code(await chooseVariant(user(), vs[0].id, hashDraft("other", "text")))).toBe("changed");
    expect(code(await chooseVariant(user(), vs[0].id, "nonsense"))).toBe("invalid");
  });
  it("a second click on the chosen version answers once; a sibling after the choice is a conflict", async () => {
    const l = await researched();
    const { variants: vs } = await variants(l.id);
    await chooseVariant(user(), vs[0].id, vs[0].bodyHash);
    expect(await chooseVariant(user(), vs[0].id, vs[0].bodyHash)).toMatchObject({ ok: true, already: true });
    expect(code(await chooseVariant(user(), vs[1].id, vs[1].bodyHash))).toBe("variant_chosen");
    expect(rows().filter((m: any) => m.status === "draft")).toHaveLength(1); // one unsent message per lead, whatever is clicked
  });
  it("a version can't be approved or edited before it is chosen", async () => {
    const l = await researched();
    const { variants: vs } = await variants(l.id);
    expect(code(await approveMessage(user(), vs[0].id, vs[0].bodyHash))).toBe("not_draft");
    expect(code(await editDraft(user(), vs[0].id, { subject: "s", body: "a long enough body to pass the structural checks easily" }))).toBe("not_editable");
  });
  it("choosing re-checks the lead NOW: marked do-not-contact since, the choice is refused", async () => {
    const l = await researched();
    // The flag is set behind the store's back (no discard ran), so only the re-check can save this.
    const { variants: vs } = await variants(l.id);
    world().leads.leads.find((x: any) => x.id === l.id)!.doNotContact = true;
    expect(code(await chooseVariant(user(), vs[0].id, vs[0].bodyHash))).toBe("do_not_contact");
  });
  it("choosing re-checks the list NOW: the address suppressed since, the choice is refused", async () => {
    const l = await researched();
    const { variants: vs } = await variants(l.id);
    world().suppressions.push({ id: 99, organizationId: ORG1, kind: "email", value: "hello@casaalma.pt", reason: "manual", sourceMessageId: null, note: null, createdBy: "u1", createdAt: new Date() });
    expect(code(await chooseVariant(user(), vs[0].id, vs[0].bodyHash))).toBe("suppressed");
  });
  it("an ordinary draft is not a version to choose", async () => {
    const l = await researched();
    const d = await draftOutreach(user(), l.id) as any;
    expect(code(await chooseVariant(user(), d.message.id, d.message.bodyHash))).toBe("not_choosable");
  });
});

describe("pending versions are discarded wherever an unsent draft would be", () => {
  it("marking the lead do-not-contact discards the whole batch", async () => {
    const l = await researched();
    await variants(l.id);
    await updateLead(user(), l.id, { doNotContact: true }, { actor: "user" });
    expect(rows().every((m: any) => m.status === "cancelled")).toBe(true);
    expect(events(l.id, "draft_cancelled")).toHaveLength(3);
    expect(code(await chooseVariant(user(), rows()[0].id, rows()[0].bodyHash))).toBe("do_not_contact");
  });
  it("putting the address on the do-not-contact list discards the whole batch", async () => {
    const l = await researched();
    await variants(l.id);
    const { addSuppression } = await import("../../sales/outreach");
    const r = await addSuppression(user(), { value: "hello@casaalma.pt" }) as any;
    expect(r.ok).toBe(true);
    expect(r.cancelled).toBe(3);
    expect(rows().every((m: any) => m.status === "cancelled")).toBe(true);
  });
  it("discarding one version discards the batch (it was one proposal), and drafting is open again", async () => {
    const l = await researched();
    const { variants: vs } = await variants(l.id);
    const r = await cancelMessage(user(), vs[1].id) as any;
    expect(r.ok).toBe(true);
    expect(rows().every((m: any) => m.status === "cancelled")).toBe(true);
    expect(events(l.id, "draft_cancelled")[0].data).toMatchObject({ messageId: vs[1].id, versions: 3 });
    expect(code(await draftOutreach(user(), l.id))).toBe("ok");
  });
});

describe("what the lead's message list shows", () => {
  it("pending versions appear with their strategy and batch, alongside everything else", async () => {
    const l = await researched();
    await variants(l.id);
    const r = await listMessages(user(), l.id) as any;
    expect(r.ok).toBe(true);
    const pending = r.messages.filter((m: any) => m.status === "variant");
    expect(pending).toHaveLength(3);
    expect(pending.every((m: any) => m.strategy && m.variantGroup)).toBe(true);
  });
  it("versions and drafts carry the deterministic quality card, marked against their own evidence", async () => {
    const l = await researched();
    await variants(l.id);
    const r = await listMessages(user(), l.id) as any;
    for (const m of r.messages) {
      expect(m.scorecard.total).toBeLessThanOrEqual(m.scorecard.max);
      expect(m.scorecard.components.length).toBeGreaterThan(3);
      for (const c of m.scorecard.components) expect(c.reason).toBeTruthy();
    }
    // The trigger version is marked against the launch claim; the direct one has no evidence of its own to be marked against.
    const keys = (s: string) => r.messages.find((m: any) => m.strategy === s)!.scorecard.components.map((c: any) => c.key);
    expect(keys("trigger")).toContain("grounding");
    expect(keys("direct")).not.toContain("grounding");
    expect(JSON.stringify(r.messages)).not.toMatch(/reply rate|probabilit|predicted/i);
  });
  it("a plain single draft carries the card too; a sent message does not", async () => {
    const l = await researched();
    await draftOutreach(user(), l.id);
    const r = await listMessages(user(), l.id) as any;
    expect(r.messages[0].status).toBe("draft");
    expect(r.messages[0].scorecard).toBeTruthy();
    const d = r.messages[0];
    await approveMessage(user(), d.id, d.bodyHash);
    await markSent(user(), d.id);
    const after = await listMessages(user(), l.id) as any;
    expect(after.messages[0].status).toBe("sent");
    expect(after.messages[0].scorecard).toBeUndefined();
  });
});
