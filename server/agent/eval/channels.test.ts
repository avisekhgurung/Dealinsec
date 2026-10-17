/**
 * Outreach on WhatsApp, LinkedIn and X, through the real service in the in-memory world, with a fake WhatsApp Cloud API
 * and a scripted model. What it pins down:
 *   - each channel's state is what the server checked (LinkedIn and X are never "connected"; WhatsApp is ready only with
 *     a live, readable connection);
 *   - WhatsApp: no message without a recorded opt-in, never after an opt-out, free text only inside the 24-hour window,
 *     templates read live, one send per approval (double click, retry, timeout → uncertain, never resent by itself),
 *     the plan's send allowance shared with email;
 *   - the webhook: signature first, statuses forward-only and only for the number's own workspace, replies stop
 *     follow-ups, "STOP" opts out, replays change nothing, unknown senders are not stored;
 *   - LinkedIn and X: drafts within the real limits, copying is not sending, "I sent it" is recorded as the person's word;
 *   - approval integrity, AI drafts only from verified facts and within the plan's allowance, workspace isolation;
 *   - the access token is sealed, never returned, and bound to its connection.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The channel store's Postgres module is never used here (the in-memory store is injected); this keeps it from connecting.
vi.mock("../../db", () => ({ db: {} }));
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
vi.mock("../../outbound/store", async () => (await import("./world-mocks")).outboundStoreMock());
vi.mock("../../llm/trace-store", async () => (await import("./world-mocks")).traceStoreMock());
vi.mock("../../routes", async () => (await import("./world-mocks")).routesMock());
vi.mock("../../copilot/provider", async (orig) => (await import("./world-mocks")).scriptedProviderMock(orig as () => Promise<any>));

import { createHmac, randomBytes } from "node:crypto";
import { hashDraft } from "@shared/outreach-hash";
import { memoryChannelStore } from "../../channels/memory-store";
import * as svc from "../../channels/service";
import { WhatsappError, type WhatsappClient, type WhatsappTemplate } from "../../channels/whatsapp-api";
import { decryptToken, loadKeyring } from "../../mail/token-crypto";
import { leadsStore } from "../../leads/store";
import { useWorld } from "./world-mocks";
import { createWorld, seedLead, userRow, ORG1, ORG2, type World } from "./world";

const world = () => (globalThis as any).__world as World;
const OWNER = () => userRow() as any;
const OTHER = () => userRow({ id: "u2", organizationId: ORG2 }) as any;
const SALES = () => userRow({ id: "u3", orgRole: "SALES" }) as any;
const READER = () => userRow({ id: "u4", orgRole: "CUSTOM", customPermissions: ["invoices.create"] }) as any;
const T0 = new Date("2026-10-18T10:00:00Z");
const ENV = { WHATSAPP_ENABLED: "true", WHATSAPP_APP_SECRET: "app-secret-test", WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-test", MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" } as NodeJS.ProcessEnv;
const PHONE = "+919876543210";
const TOKEN = "EAAG-test-token-0123456789abcdef";

/* ── fakes ───────────────────────────────────────────────────────────────── */

let now = T0;
let mem: ReturnType<typeof memoryChannelStore>;
let waCalls: { op: string; token: string; to?: string; body?: string; template?: string }[] = [];
let waBehaviour: { send?: () => Error | null; templates?: WhatsappTemplate[]; phoneInfo?: () => Error | null } = {};
let suppressions: { orgId: string; kind: string; value: string; reason: string }[] = [];
let stopped: { orgId: string; leadId: number; reason: string }[] = [];
let providerCalls: any[] = [];
let modelText = "Hello, I saw that you run a family dental clinic in Siliguri. I build simple websites for clinics. Would a quick chat next week be useful?";
let emailSends = 0;

const TEMPLATE: WhatsappTemplate = { name: "intro_v1", language: "en", category: "marketing", body: "Hi {{1}}, thanks for your interest in {{2}}. Can we talk?", params: 2 };
const wa: WhatsappClient = {
  async phoneInfo(token) { waCalls.push({ op: "phoneInfo", token }); const e = waBehaviour.phoneInfo?.(); if (e) throw e; return { displayPhone: "+91 98000 11111", verifiedName: "Asha Studio" }; },
  async templates(token) { waCalls.push({ op: "templates", token }); return waBehaviour.templates ?? [TEMPLATE]; },
  async sendText(token, _pid, to, body) { waCalls.push({ op: "text", token, to, body }); const e = waBehaviour.send?.(); if (e) throw e; return { id: `wamid.${waCalls.length}` }; },
  async sendTemplate(token, _pid, to, t) { waCalls.push({ op: "template", token, to, template: t.name }); const e = waBehaviour.send?.(); if (e) throw e; return { id: `wamid.${waCalls.length}` }; },
};
const deps = (over: Partial<svc.ChannelDeps> = {}): Partial<svc.ChannelDeps> => ({
  store: mem.store, wa, now: () => now, env: ENV, ready: async () => true, tier: async () => "pro",
  chat: (async () => ({ content: JSON.stringify({ text: modelText }), toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } })) as any,
  safety: {
    suppressedMatch: async (orgId: string, keys: { kind: string; value: string }[]) => (suppressions.find((s) => s.orgId === orgId && keys.some((k) => k.kind === s.kind && k.value === s.value)) as any) ?? null,
    addSuppression: async (orgId: string, e: any) => { suppressions.push({ orgId, kind: e.kind, value: e.value, reason: e.reason }); return { row: e, created: true } as any; },
    stopLeadFollowups: async (o: any) => { stopped.push({ orgId: o.orgId, leadId: o.leadId, reason: o.reason }); return 1; },
  },
  safetyReady: async () => true,
  recordProviderCall: async (r) => { providerCalls.push(r); },
  ...over,
});
const d = () => deps();

/** A lead with a verified fact (so AI drafts have something true to say). */
async function lead(over: Record<string, any> = {}, orgId = ORG1) {
  const l = seedLead(world(), { companyName: "Smile Dental", website: "https://smiledental.in", domain: "smiledental.in", status: "researching", ...over }, orgId);
  await leadsStore.addClaim(orgId, l.id, { field: "description", value: "A family dental clinic in Siliguri", status: "confirmed", evidenceUrl: "https://smiledental.in/", evidenceSnippet: "a family dental clinic in Siliguri", source: "agent" });
  return l;
}
const ok = <T>(r: any): T => { if (!r.ok) throw new Error(`${r.code}: ${r.message}`); return r; };
async function connect(user = OWNER()) { return ok<any>(await svc.connectWhatsapp(user, { phoneNumberId: "1234567890", wabaId: "9876543210", accessToken: TOKEN }, d())); }
async function optIn(leadId: number, user = OWNER()) { return ok<any>(await svc.recordWhatsappOptIn(user, leadId, { phone: "+91 98765 43210", source: "Asked us to WhatsApp them on our website form, 12 Oct" }, d())); }
/** They wrote to the business: opens the 24-hour window (as the webhook would record it). */
async function theyWrote(at = now, orgId = ORG1) { await mem.store.touchInbound(orgId, PHONE, at); }
async function approved(channel: string, kind: string, leadId: number, extra: Record<string, unknown> = {}, user = OWNER()) {
  const m = ok<any>(await svc.draftChannelMessage(user, leadId, { channel, kind, write: "own", text: "Hello from Asha Studio. Would a short chat about your website be useful?", ...extra }, d())).message;
  return ok<any>(await svc.approveChannelMessage(user, m.id, m.bodyHash, d())).message;
}
const sign = (body: string, secret = ENV.WHATSAPP_APP_SECRET!) => `sha256=${createHmac("sha256", secret).update(Buffer.from(body)).digest("hex")}`;
const hook = async (payload: unknown, sig?: string) => { const raw = JSON.stringify(payload); return svc.handleWhatsappWebhook(Buffer.from(raw), sig ?? sign(raw), d()); };
const notification = (value: Record<string, unknown>, phoneNumberId = "1234567890") => ({ object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId }, ...value } }] }] });
const status = (wamid: string, s: string, ts = T0.getTime() / 1000 + 60, errors?: unknown[]) => notification({ statuses: [{ id: wamid, status: s, timestamp: String(ts), recipient_id: PHONE.slice(1), ...(errors ? { errors } : {}) }] });
const inbound = (wamid: string, text: string, from = PHONE.slice(1), ts = T0.getTime() / 1000 + 120) => notification({ messages: [{ from, id: wamid, timestamp: String(ts), type: "text", text: { body: text } }] });

beforeEach(() => {
  useWorld(createWorld());
  now = T0; waCalls = []; waBehaviour = {}; suppressions = []; stopped = []; providerCalls = []; emailSends = 0;
  mem = memoryChannelStore({ emailSends: () => emailSends });
});

/* ── channel states ─────────────────────────────────────────────────────── */

describe("each channel's state is what the server checked", () => {
  it("LinkedIn and X are drafts only, never connected; WhatsApp is ready only with a live connection", async () => {
    const before = ok<any>(await svc.channelStatuses(OWNER(), d())).channels;
    const by = (cs: any[], c: string) => cs.find((x) => x.channel === c);
    expect(by(before, "linkedin")).toMatchObject({ state: "sending_unavailable", mode: "manual", capabilities: { send: false, replySync: false, openExternal: true } });
    expect(by(before, "x")).toMatchObject({ state: "sending_unavailable", mode: "manual", capabilities: { send: false } });
    expect(by(before, "whatsapp")).toMatchObject({ state: "awaiting_connection", mode: "manual", capabilities: { send: false } });
    await connect();
    expect(by(ok<any>(await svc.channelStatuses(OWNER(), d())).channels, "whatsapp")).toMatchObject({ state: "ready_to_send", mode: "api", account: "+91 98000 11111", capabilities: { send: true, deliveryStatus: true, replySync: true } });
    // Another workspace sees its own state, not this connection.
    expect(by(ok<any>(await svc.channelStatuses(OTHER(), d())).channels, "whatsapp").state).toBe("awaiting_connection");
  });

  it("not switched on (flag, secrets, key ring, allowlist or tables): not configured, and nothing can connect", async () => {
    for (const env of [{ ...ENV, WHATSAPP_ENABLED: undefined }, { ...ENV, WHATSAPP_APP_SECRET: "" }, { ...ENV, MAILBOX_TOKEN_KEYS: "" }, { ...ENV, WHATSAPP_ALLOWED_ORG_IDS: "someone-else" }]) {
      const s = ok<any>(await svc.channelStatuses(OWNER(), deps({ env: env as any }))).channels.find((x: any) => x.channel === "whatsapp");
      expect(s.state).toBe("not_configured");
      expect(await svc.connectWhatsapp(OWNER(), { phoneNumberId: "1234567890", wabaId: "9876543210", accessToken: TOKEN }, deps({ env: env as any }))).toMatchObject({ ok: false });
    }
    expect(ok<any>(await svc.channelStatuses(OWNER(), deps({ ready: async () => false }))).channels.every((c: any) => c.state === "not_configured")).toBe(true);
    expect(waCalls).toHaveLength(0);
  });

  it("a token WhatsApp stops accepting puts the connection in 'permission missing'", async () => {
    await connect();
    const l = await lead(); await optIn(l.id); await theyWrote();
    const m = await approved("whatsapp", "text", l.id, { to: PHONE });
    waBehaviour.send = () => new WhatsappError("auth", 190, "x");
    expect(await svc.sendWhatsapp(OWNER(), m.id, m.bodyHash, d())).toMatchObject({ ok: false, code: "whatsapp_auth" });
    const s = ok<any>(await svc.channelStatuses(OWNER(), d())).channels.find((x: any) => x.channel === "whatsapp");
    expect(s).toMatchObject({ state: "permission_missing", capabilities: { send: false } });
  });
});

/* ── connection and credentials ─────────────────────────────────────────── */

describe("connecting a WhatsApp Business number", () => {
  it("is for owners and admins, checks the details with WhatsApp first, seals the token and never returns it", async () => {
    expect(await svc.connectWhatsapp(SALES(), { phoneNumberId: "1234567890", wabaId: "9876543210", accessToken: TOKEN }, d())).toMatchObject({ ok: false, status: 403 });
    waBehaviour.phoneInfo = () => new WhatsappError("auth", 190, "x");
    expect(await svc.connectWhatsapp(OWNER(), { phoneNumberId: "1234567890", wabaId: "9876543210", accessToken: TOKEN }, d())).toMatchObject({ ok: false, code: "whatsapp_check_failed" });
    expect(mem.connections).toHaveLength(0); // nothing stored when WhatsApp refused it
    waBehaviour = {};
    const r = await connect();
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    const row = mem.connections[0];
    expect(row.accessTokenEnc).not.toContain(TOKEN);
    expect(decryptToken(row.accessTokenEnc!, { organizationId: ORG1, userId: "u1", connectionId: row.id, provider: "whatsapp" }, loadKeyring(ENV))).toBe(TOKEN);
    // Bound to its connection: the same ciphertext can't be read as another connection's, or as a mailbox token.
    expect(() => decryptToken(row.accessTokenEnc!, { organizationId: ORG1, userId: "u1", connectionId: row.id + 1, provider: "whatsapp" }, loadKeyring(ENV))).toThrow();
    expect(() => decryptToken(row.accessTokenEnc!, { organizationId: ORG1, userId: "u1", connectionId: row.id, provider: "gmail" }, loadKeyring(ENV))).toThrow();
    expect(JSON.stringify(ok<any>(await svc.whatsappConnectionStatus(OWNER(), d())))).not.toContain(TOKEN);
  });

  it("one live number per workspace and per number; disconnecting deletes the sealed token", async () => {
    await connect();
    expect(await svc.connectWhatsapp(OWNER(), { phoneNumberId: "5555555555", wabaId: "9876543210", accessToken: TOKEN }, d())).toMatchObject({ ok: false, code: "already_connected" });
    expect(await svc.connectWhatsapp(OTHER(), { phoneNumberId: "1234567890", wabaId: "9876543210", accessToken: TOKEN }, d())).toMatchObject({ ok: false, code: "already_connected" });
    expect(ok<any>(await svc.disconnectWhatsapp(OWNER(), d())).disconnected).toBe(true);
    expect(mem.connections[0]).toMatchObject({ status: "disconnected", accessTokenEnc: null, tokenKeyVersion: null });
    expect(ok<any>(await svc.connectWhatsapp(OTHER(), { phoneNumberId: "1234567890", wabaId: "9876543210", accessToken: TOKEN }, d())).connection.status).toBe("active");
  });
});

/* ── WhatsApp permission and the 24-hour window ─────────────────────────── */

describe("WhatsApp: permission first", () => {
  it("no draft for a number without a recorded opt-in; a public phone number is not permission", async () => {
    const l = await lead();
    const r: any = await svc.draftChannelMessage(OWNER(), l.id, { channel: "whatsapp", kind: "text", to: PHONE, write: "own", text: "Hello there, a quick question about your website." }, d());
    expect(r).toMatchObject({ ok: false, code: "no_opt_in" });
    expect(r.message).toMatch(/isn't permission/);
    // The opt-in needs to say how they agreed.
    expect(await svc.recordWhatsappOptIn(OWNER(), l.id, { phone: PHONE, source: "yes" }, d())).toMatchObject({ ok: false, status: 400 });
    expect(ok<any>(await optIn(l.id)).contact).toMatchObject({ phone: PHONE, optedIn: true, optedOut: false, windowOpenUntil: null });
    expect((await svc.draftChannelMessage(OWNER(), l.id, { channel: "whatsapp", kind: "text", to: PHONE, write: "own", text: "Hello there, a quick question about your website." }, d())).ok).toBe(true);
  });

  it("free text only inside the 24-hour window; a template outside it, read live and filled exactly as approved", async () => {
    await connect();
    const l = await lead(); await optIn(l.id);
    const text = await approved("whatsapp", "text", l.id, { to: PHONE });
    expect(await svc.sendWhatsapp(OWNER(), text.id, text.bodyHash, d())).toMatchObject({ ok: false, code: "window_closed" });
    expect(waCalls.filter((c) => c.op === "text")).toHaveLength(0);
    await svc.cancelChannelMessage(OWNER(), text.id, d());
    // A template, with its values: the approved text is the template's own wording filled in.
    const t = ok<any>(await svc.draftChannelMessage(OWNER(), l.id, { channel: "whatsapp", kind: "template", to: PHONE, write: "own", template: { name: "intro_v1", language: "en", params: ["Dr. Rao", "website design"] } }, d())).message;
    expect(t.body).toBe("Hi Dr. Rao, thanks for your interest in website design. Can we talk?");
    expect(await svc.draftChannelMessage(OWNER(), l.id, { channel: "whatsapp", kind: "template", to: PHONE, write: "own", template: { name: "intro_v1", language: "en", params: ["one"] } }, d())).toMatchObject({ ok: false, code: "template_params" });
    await svc.approveChannelMessage(OWNER(), t.id, t.bodyHash, d());
    // Paused or rejected meanwhile: not sent.
    waBehaviour.templates = [];
    expect(await svc.sendWhatsapp(OWNER(), t.id, t.bodyHash, d())).toMatchObject({ ok: false, code: "template_unavailable" });
    waBehaviour.templates = undefined;
    const sent = ok<any>(await svc.sendWhatsapp(OWNER(), t.id, t.bodyHash, d())).message;
    expect(sent).toMatchObject({ status: "sent", sentVia: "api", delivery: null, statusLabel: "Sent" });
    expect(waCalls.filter((c) => c.op === "template")).toEqual([{ op: "template", token: TOKEN, to: PHONE, template: "intro_v1" }]);
    // Inside the window a free-text message goes out.
    await theyWrote(new Date(now.getTime() - 3_600_000));
    const l2 = await lead({ companyName: "Pearl Dental", domain: "pearl.in" });
    await svc.recordWhatsappOptIn(OWNER(), l2.id, { phone: "+919800000002", source: "Gave us their number at our clinic event, 10 Oct" }, d());
    await mem.store.touchInbound(ORG1, "+919800000002", new Date(now.getTime() - 3_600_000));
    const t2 = await approved("whatsapp", "text", l2.id, { to: "+919800000002" });
    expect(ok<any>(await svc.sendWhatsapp(OWNER(), t2.id, t2.bodyHash, d())).message.status).toBe("sent");
  });

  it("an opt-out (theirs, or recorded) blocks drafts, approvals and sends for good, and stops follow-ups", async () => {
    await connect();
    const l = await lead(); await optIn(l.id); await theyWrote();
    const m = await approved("whatsapp", "text", l.id, { to: PHONE });
    ok(await svc.recordWhatsappOptOut(OWNER(), l.id, { phone: PHONE }, d()));
    expect(suppressions).toEqual([{ orgId: ORG1, kind: "phone", value: PHONE, reason: "opt_out" }]);
    expect(stopped).toEqual([{ orgId: ORG1, leadId: l.id, reason: "opted_out" }]);
    expect((await mem.store.get(ORG1, m.id))!.status).toBe("cancelled"); // the unsent message to them is discarded
    expect(await svc.sendWhatsapp(OWNER(), m.id, m.bodyHash, d())).toMatchObject({ ok: false });
    expect(await svc.recordWhatsappOptIn(OWNER(), l.id, { phone: PHONE, source: "They said yes again on a call" }, d())).toMatchObject({ ok: false, code: "suppressed" });
    expect(waCalls.filter((c) => c.op === "text")).toHaveLength(0);
  });
});

/* ── sending: one send per approval ─────────────────────────────────────── */

describe("WhatsApp: exactly the approved text, once", () => {
  async function ready() { await connect(); const l = await lead(); await optIn(l.id); await theyWrote(); return { l, m: await approved("whatsapp", "text", l.id, { to: PHONE }) }; }

  it("a different text, an unapproved draft, or a stale hash is refused before WhatsApp is called", async () => {
    const { l, m } = await ready();
    expect(await svc.sendWhatsapp(OWNER(), m.id, hashDraft("", "something else"), d())).toMatchObject({ ok: false, code: "changed" });
    const edited = ok<any>(await svc.editChannelMessage(OWNER(), m.id, { text: "A different message, edited after approval." }, d())).message;
    expect(edited.status).toBe("draft"); // editing an approved message sends it back for approval
    expect(await svc.sendWhatsapp(OWNER(), m.id, edited.bodyHash, d())).toMatchObject({ ok: false, code: "not_approved" });
    expect(await svc.approveChannelMessage(OWNER(), m.id, m.bodyHash, d())).toMatchObject({ ok: false, code: "changed" }); // the old text can't be approved
    expect(waCalls.filter((c) => c.op === "text")).toHaveLength(0);
    expect(l.id).toBeGreaterThan(0);
  });

  it("concurrent clicks send once; the second sees it sending or sent", async () => {
    const { m } = await ready();
    const out = await Promise.all([1, 2, 3].map(() => svc.sendWhatsapp(OWNER(), m.id, m.bodyHash, d())));
    expect(waCalls.filter((c) => c.op === "text")).toHaveLength(1);
    expect(out.filter((r: any) => r.ok)).not.toHaveLength(0);
    const row = (await mem.store.get(ORG1, m.id))!;
    expect(row).toMatchObject({ status: "sent", sentVia: "api", providerMessageId: expect.stringMatching(/^wamid\./), attempts: 1 });
    expect(providerCalls).toEqual([expect.objectContaining({ provider: "whatsapp", operation: "whatsapp_text", ok: true, costMicroUsd: 0 })]);
  });

  it("no answer → uncertain, never resent by itself; a person settles it", async () => {
    const { m } = await ready();
    waBehaviour.send = () => new WhatsappError("uncertain", null, "timeout");
    expect(await svc.sendWhatsapp(OWNER(), m.id, m.bodyHash, d())).toMatchObject({ ok: false, code: "uncertain" });
    waBehaviour = {};
    expect(await svc.sendWhatsapp(OWNER(), m.id, m.bodyHash, d())).toMatchObject({ ok: false, code: "not_approved" });
    expect(await svc.cancelChannelMessage(OWNER(), m.id, d())).toMatchObject({ ok: false });
    expect(waCalls.filter((c) => c.op === "text")).toHaveLength(1);
    expect(ok<any>(await svc.resolveUncertain(OWNER(), m.id, { outcome: "not_sent" }, d())).message.status).toBe("failed");
  });

  it("a refusal is failed (not uncertain), keeps its reason, and frees the plan's send slot", async () => {
    const { m } = await ready();
    waBehaviour.send = () => new WhatsappError("recipient", 131026, "x");
    expect(await svc.sendWhatsapp(OWNER(), m.id, m.bodyHash, d())).toMatchObject({ ok: false });
    expect((await mem.store.get(ORG1, m.id))).toMatchObject({ status: "failed", errorCode: "whatsapp_recipient" });
    expect(await mem.store.countApiSends(ORG1, new Date(0))).toBe(0);
  });

  it("the plan's send allowance is one number with Gmail: email sends count, and the limit is enforced before WhatsApp is called", async () => {
    const { m } = await ready();
    emailSends = 10; // Pro: 10 sends in 30 days, all used by Gmail
    expect(await svc.sendWhatsapp(OWNER(), m.id, m.bodyHash, d())).toMatchObject({ ok: false, code: "plan_send_limit" });
    expect(waCalls.filter((c) => c.op === "text")).toHaveLength(0);
    expect((await mem.store.get(ORG1, m.id))!.status).toBe("approved"); // still sendable once a slot frees up
    expect(await svc.sendWhatsapp(OWNER(), m.id, m.bodyHash, deps({ tier: async () => "free" }))).toMatchObject({ ok: false, status: 402, code: "NO_CREDITS" });
  });

  it("a do-not-contact lead can't be sent to, whatever was approved", async () => {
    const { l, m } = await ready();
    await leadsStore.update(ORG1, l.id, { doNotContact: true } as any);
    expect(await svc.sendWhatsapp(OWNER(), m.id, m.bodyHash, d())).toMatchObject({ ok: false, code: "do_not_contact" });
    expect(waCalls.filter((c) => c.op === "text")).toHaveLength(0);
  });
});

/* ── the webhook ────────────────────────────────────────────────────────── */

describe("the WhatsApp webhook", () => {
  async function sentMessage() {
    await connect(); const l = await lead(); await optIn(l.id); await theyWrote();
    const m = await approved("whatsapp", "text", l.id, { to: PHONE });
    const sent = ok<any>(await svc.sendWhatsapp(OWNER(), m.id, m.bodyHash, d())).message;
    return { l, sent, wamid: (await mem.store.get(ORG1, sent.id))!.providerMessageId! };
  }

  it("refuses a missing or wrong signature, and answers the handshake only for our verify token", async () => {
    const { wamid } = await sentMessage();
    const body = JSON.stringify(status(wamid, "delivered"));
    expect((await svc.handleWhatsappWebhook(Buffer.from(body), undefined, d())).status).toBe(401);
    expect((await svc.handleWhatsappWebhook(Buffer.from(body), sign(body, "wrong-secret"), d())).status).toBe(401);
    expect((await svc.handleWhatsappWebhook(Buffer.from(body), sign(body.replace("delivered", "read ")), d())).status).toBe(401);
    expect((await mem.store.byProviderId("whatsapp", wamid))!.delivery).toBeNull(); // nothing applied
    const { verifyChallenge } = await import("../../channels/whatsapp-webhook");
    expect(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "verify-test", "hub.challenge": "1158201444" }, "verify-test")).toBe("1158201444");
    expect(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "1" }, "verify-test")).toBeNull();
    expect(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "verify-test", "hub.challenge": "1" }, undefined)).toBeNull();
  });

  it("delivery only moves forward; replays and out-of-order reports change nothing", async () => {
    const { wamid, sent } = await sentMessage();
    expect((await hook(status(wamid, "read"))).applied.statuses).toBe(1);
    expect((await hook(status(wamid, "delivered"))).applied.statuses).toBe(0); // late "delivered" after "read"
    expect((await hook(status(wamid, "read"))).applied.statuses).toBe(0); // replay
    expect((await hook(status(wamid, "failed", undefined, [{ code: 131026 }]))).applied.statuses).toBe(0); // can't fail after delivery
    const row = (await mem.store.get(ORG1, sent.id))!;
    expect(row).toMatchObject({ status: "sent", delivery: "read" });
    expect(svc.channelMessageView(row).statusLabel).toBe("Read");
  });

  it("a report for another workspace's message, or an unknown number, is ignored", async () => {
    const { wamid } = await sentMessage();
    await svc.connectWhatsapp(OTHER(), { phoneNumberId: "2222222222", wabaId: "9876543210", accessToken: TOKEN }, d());
    expect((await hook(status(wamid, "delivered").entry ? { ...status(wamid, "delivered"), entry: [{ id: "x", changes: [{ field: "messages", value: { metadata: { phone_number_id: "2222222222" }, statuses: [{ id: wamid, status: "delivered", timestamp: "1" }] } }] }] } : {})).applied).toMatchObject({ statuses: 0, ignored: 1 });
    expect((await hook(status(wamid, "delivered"), undefined)).applied.statuses).toBe(1);
    expect((await hook(notification({ statuses: [{ id: wamid, status: "read", timestamp: "1" }] }, "9999999999"))).applied).toMatchObject({ statuses: 0, ignored: 1 });
  });

  it("a reply is stored once, marks the message replied, opens the window and stops follow-ups; the lead moves to replied", async () => {
    const { l, sent } = await sentMessage();
    expect((await hook(inbound("wamid.in.1", "Yes, tell me more"))).applied.inbound).toBe(1);
    expect((await hook(inbound("wamid.in.1", "Yes, tell me more"))).applied.inbound).toBe(0); // replay
    const msgs = ok<any>(await svc.listChannelMessages(OWNER(), l.id, d())).messages;
    expect(msgs.filter((m: any) => m.direction === "in")).toEqual([expect.objectContaining({ body: "Yes, tell me more", statusLabel: "Received" })]);
    expect(msgs.find((m: any) => m.id === sent.id)).toMatchObject({ statusLabel: "Reply received", repliedAt: expect.any(String) });
    expect(stopped).toEqual([{ orgId: ORG1, leadId: l.id, reason: "replied" }]);
    expect((await leadsStore.get(ORG1, l.id))!.status).toBe("replied");
    expect((await mem.store.contact(ORG1, PHONE))!.lastInboundAt).toEqual(new Date((T0.getTime() / 1000 + 120) * 1000));
  });

  it("\"STOP\" opts the number out: on the list, unsent messages discarded, follow-ups stopped", async () => {
    const { l } = await sentMessage();
    await hook(inbound("wamid.in.2", "STOP"));
    expect(suppressions).toEqual([{ orgId: ORG1, kind: "phone", value: PHONE, reason: "opt_out" }]);
    expect((await mem.store.contact(ORG1, PHONE))!.optedOutAt).not.toBeNull();
    expect(stopped).toContainEqual({ orgId: ORG1, leadId: l.id, reason: "opted_out" });
    expect(await svc.draftChannelMessage(OWNER(), l.id, { channel: "whatsapp", kind: "text", to: PHONE, write: "own", text: "Just one more thing, quickly." }, d())).toMatchObject({ ok: false });
  });

  it("a message from a number the workspace never dealt with is not stored", async () => {
    await sentMessage();
    const out = await hook(inbound("wamid.in.3", "Who is this?", "447700900123"));
    expect(out.applied).toMatchObject({ inbound: 0, ignored: 1 });
    expect(mem.messages.some((m) => m.providerMessageId === "wamid.in.3")).toBe(false);
  });
});

/* ── LinkedIn and X: drafts, and the person sends ────────────────────────── */

describe("LinkedIn and X: drafted here, sent by the person", () => {
  it("a connection note keeps LinkedIn's limit (200, or 300 with Premium); an X handle or a LinkedIn page link is checked", async () => {
    const l = await lead();
    const long = "I help clinics in Siliguri with simple, fast websites. ".repeat(5).slice(0, 250);
    expect(await svc.draftChannelMessage(OWNER(), l.id, { channel: "linkedin", kind: "connection_note", write: "own", text: long }, d())).toMatchObject({ ok: false, code: "invalid_text" });
    expect((await svc.draftChannelMessage(OWNER(), l.id, { channel: "linkedin", kind: "connection_note", write: "own", text: long, premium: true }, d())).ok).toBe(true);
    expect(await svc.draftChannelMessage(OWNER(), l.id, { channel: "x", kind: "dm", to: "not a handle!", write: "own", text: "Hello there" }, d())).toMatchObject({ ok: false, code: "bad_recipient" });
    expect(ok<any>(await svc.draftChannelMessage(OWNER(), l.id, { channel: "x", kind: "dm", to: "https://x.com/SmileDental", write: "own", text: "Hello there, quick question." }, d())).message.to).toBe("SmileDental");
    expect(await svc.draftChannelMessage(OWNER(), l.id, { channel: "linkedin", kind: "message", to: "https://evil.com/in/x", write: "own", text: "Hello there" }, d())).toMatchObject({ ok: false, code: "bad_recipient" });
    // One unsent message per lead and channel: the Premium-length note above is still waiting.
    expect(await svc.draftChannelMessage(OWNER(), l.id, { channel: "linkedin", kind: "message", write: "own", text: "Hello there" }, d())).toMatchObject({ ok: false, code: "draft_exists" });
  });

  it("an AI draft is written only from verified facts, checked, within the length, and counts against the plan's AI drafts", async () => {
    const l = await lead();
    const m = ok<any>(await svc.draftChannelMessage(OWNER(), l.id, { channel: "linkedin", kind: "connection_note", write: "ai" }, d())).message;
    expect(m.body.length).toBeLessThanOrEqual(200);
    expect(mem.messages[0].promptVersion).toMatch(/^draft-/);
    // A model text with a price or a link is refused (after one retry), never stored.
    modelText = "Our websites start at $499, see www.example-agency.com for details and a chat.";
    const l2 = await lead({ companyName: "Two", domain: "two.in" });
    expect(await svc.draftChannelMessage(OWNER(), l2.id, { channel: "x", kind: "dm", write: "ai" }, d())).toMatchObject({ ok: false, code: "draft_rejected" });
    // No verified facts: nothing to write from.
    const bare = seedLead(world(), { companyName: "Bare" });
    expect(await svc.draftChannelMessage(OWNER(), bare.id, { channel: "x", kind: "dm", write: "ai" }, d())).toMatchObject({ ok: false, code: "no_facts" });
    // The allowance: AI drafts on email and channels together (Pro: 10).
    const capped = memoryChannelStore({ emailAiDrafts: () => 10 });
    expect(await svc.draftChannelMessage(OWNER(), l2.id, { channel: "x", kind: "dm", write: "ai" }, deps({ store: capped.store }))).toMatchObject({ ok: false, code: "draft_allowance" });
    modelText = "Hello, I saw that you run a family dental clinic in Siliguri. I build simple websites for clinics. Would a quick chat next week be useful?";
  });

  it("copying isn't sending: only 'I sent it' records a send, as the person's word, never a delivery; DealInSec can't send it", async () => {
    const l = await lead();
    const m = await approved("linkedin", "message", l.id, { to: "linkedin.com/in/asha-rao" });
    expect(m).toMatchObject({ status: "approved", to: "https://www.linkedin.com/in/asha-rao/" });
    expect(await svc.sendWhatsapp(OWNER(), m.id, m.bodyHash, d())).toMatchObject({ ok: false, code: "manual_channel" });
    const sent = ok<any>(await svc.markChannelSent(OWNER(), m.id, m.bodyHash, d())).message;
    expect(sent).toMatchObject({ status: "sent", sentVia: "manual", delivery: null, statusLabel: "You marked it sent on LinkedIn" });
    expect((await leadsStore.get(ORG1, l.id))!.status).toBe("contacted");
    expect(ok<any>(await svc.markChannelSent(OWNER(), m.id, m.bodyHash, d())).already).toBe(true); // a double click records it once
    // No reply sync here: the person records it, and follow-ups stop.
    const replied = ok<any>(await svc.recordChannelReply(OWNER(), m.id, d())).message;
    expect(replied.statusLabel).toBe("Reply recorded by you");
    expect(stopped).toEqual([{ orgId: ORG1, leadId: l.id, reason: "replied" }]);
  });

  it("WhatsApp from their own phone is manual only without a connected number, and still needs the opt-in", async () => {
    const l = await lead(); await optIn(l.id);
    const m = await approved("whatsapp", "text", l.id, { to: PHONE });
    expect(ok<any>(await svc.markChannelSent(OWNER(), m.id, m.bodyHash, d())).message.statusLabel).toBe("You marked it sent on WhatsApp");
    await connect();
    const l2 = await lead({ companyName: "Three", domain: "three.in" });
    await svc.recordWhatsappOptIn(OWNER(), l2.id, { phone: "+919800000003", source: "Messaged us first on WhatsApp, 14 Oct" }, d());
    const m2 = await approved("whatsapp", "text", l2.id, { to: "+919800000003" });
    expect(await svc.markChannelSent(OWNER(), m2.id, m2.bodyHash, d())).toMatchObject({ ok: false, code: "use_api" });
  });
});

/* ── isolation and permissions ──────────────────────────────────────────── */

describe("workspace isolation and permissions", () => {
  it("another workspace can't read, approve, send, mark or cancel a message, and a reader can't write", async () => {
    const l = await lead();
    const m = await approved("x", "dm", l.id);
    for (const r of [
      await svc.approveChannelMessage(OTHER(), m.id, m.bodyHash, d()), await svc.markChannelSent(OTHER(), m.id, m.bodyHash, d()),
      await svc.cancelChannelMessage(OTHER(), m.id, d()), await svc.editChannelMessage(OTHER(), m.id, { text: "hijacked text here" }, d()),
      await svc.listChannelMessages(OTHER(), l.id, d()),
    ]) expect(r).toMatchObject({ ok: false, status: 404 });
    expect(await svc.draftChannelMessage(READER(), l.id, { channel: "x", kind: "dm", write: "own", text: "Hello there" }, d())).toMatchObject({ ok: false, status: 403 });
    expect((await mem.store.get(ORG1, m.id))!.status).toBe("approved");
  });

  it("a closed or do-not-contact lead takes no draft", async () => {
    const won = await lead({ status: "won", companyName: "Won", domain: "won.in" });
    expect(await svc.draftChannelMessage(OWNER(), won.id, { channel: "x", kind: "dm", write: "own", text: "Hello there" }, d())).toMatchObject({ ok: false, code: "closed" });
    const dnc = await lead({ doNotContact: true, companyName: "Dnc", domain: "dnc.in" });
    expect(await svc.draftChannelMessage(OWNER(), dnc.id, { channel: "linkedin", kind: "message", write: "own", text: "Hello there" }, d())).toMatchObject({ ok: false, code: "do_not_contact" });
  });
});
