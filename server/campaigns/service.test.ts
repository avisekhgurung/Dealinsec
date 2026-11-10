/**
 * Campaigns, the rules and the background job, against an in-memory store: who may do what, that a workspace only
 * ever touches its own, and — the part that matters most — what the job does and refuses to do when it drafts and
 * when it sends. No database, no model, no mail provider.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_CAMPAIGNS, OPT_OUT_LINE, withFooter } from "@shared/campaign";
import { hashDraft } from "@shared/outreach-hash";

vi.mock("../db", () => ({ db: {} }));

let svc: typeof import("./service");
let classifyReply: typeof import("../mail/reply-rules").classifyReply;
beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
  svc = await import("./service");
  ({ classifyReply } = await import("../mail/reply-rules"));
}, 60_000);

const T0 = new Date("2026-11-10T10:00:00Z");
const ana = { id: "ana", organizationId: "org-a", memberStatus: "active", orgRole: "SALES" } as any;
const bob = { id: "bob", organizationId: "org-b", memberStatus: "active", orgRole: "SALES" } as any;
const viewer = { id: "vic", organizationId: "org-a", memberStatus: "active", orgRole: "VIEWER" } as any;
const BODY = "Hi Asha, I noticed your store launched a new range last month and wanted to say hello.";

function world() {
  let clock = T0.getTime();
  const campaigns: any[] = [], members: any[] = [], messages: any[] = [], events: any[] = [];
  const leads: any[] = [1, 2, 3, 4, 5].map((id) => ({ id, org: "org-a", companyName: `Lead ${id}`, status: "new", source: "manual", doNotContact: false, archived: false }));
  leads.push({ id: 9, org: "org-b", companyName: "Other workspace's lead", status: "new", source: "manual", doNotContact: false, archived: false });
  let cSeq = 0, mSeq = 0, msgSeq = 100;
  const calls = { draft: [] as any[], send: [] as any[], kick: 0, log: [] as any[] };
  const draftPlan = new Map<number, any>(); // leadId -> { ok:false, code } | "throw"; default ok
  let sendPlan: any = { ok: true, outcome: "sent" };
  let queueOn = true;
  let linkBase: string | null = null; // no unsubscribe link unless a test turns it on
  const users: Record<string, any> = { ana, bob, vic: viewer };
  const now = () => new Date(clock);
  const msg = (id: number | null) => messages.find((m) => m.id === id) ?? null;
  const addMessage = (leadId: number, over: Record<string, unknown> = {}) => {
    const body = (over.body as string) ?? BODY;
    const m = { id: ++msgSeq, org: "org-a", leadId, status: "draft", subject: "Hello", body, bodyHash: hashDraft("Hello", body), approvedAt: null, sentAt: null, ...over };
    messages.push(m); return m;
  };
  const view = (m: any) => {
    const lm = msg(m.messageId), l = leads.find((x) => x.id === m.leadId && x.org === m.organizationId);
    return {
      id: m.id, leadId: m.leadId, state: m.state, reason: m.reason ?? null, attempts: m.attempts, holdReason: m.holdReason ?? null, holdHash: m.holdHash ?? null,
      lead: l ? { companyName: l.companyName, domain: null, status: l.status, contactName: null, contactEmail: null, doNotContact: l.doNotContact, archived: l.archived } : null,
      message: lm ? { id: lm.id, status: lm.status, subject: lm.subject, to: "a@x.example", bodyHash: lm.bodyHash, edited: false, approvedAt: lm.approvedAt, sentAt: lm.sentAt } : null,
      outcomes: events.filter((e) => e.messageId === m.messageId).map((e) => e.kind), interested: false,
    };
  };
  const store: any = {
    list: async (o: string) => campaigns.filter((c) => c.organizationId === o),
    get: async (o: string, id: number) => campaigns.find((c) => c.organizationId === o && c.id === id) ?? null,
    create: async (o: string, userId: string, c: any, leadIds: number[], at: Date, max: number) => {
      if (campaigns.filter((x) => x.organizationId === o && x.status === "active").length >= max) return null;
      const row = { id: ++cSeq, organizationId: o, createdByUser: userId, status: "active", preparing: false, prepareUserId: null, prepareStop: null, sending: false, senderUserId: null, sendStop: null, nextSendAt: null, leaseUntil: null, createdAt: at, updatedAt: at, ...c };
      campaigns.push(row);
      for (const leadId of leadIds) members.push({ id: ++mSeq, campaignId: row.id, organizationId: o, leadId, messageId: null, state: "queued", reason: null, attempts: 0, holdReason: null, holdHash: null, leaseUntil: null, updatedAt: at });
      return row;
    },
    update: async (o: string, id: number, patch: any) => { const c = await store.get(o, id); if (!c) return null; Object.assign(c, patch); return c; },
    addMembers: async (o: string, id: number, leadIds: number[], at: Date, max: number) => {
      const have = members.filter((m) => m.campaignId === id);
      const fresh = leadIds.filter((l) => !have.some((m) => m.leadId === l)).slice(0, Math.max(0, max - have.length));
      for (const leadId of fresh) members.push({ id: ++mSeq, campaignId: id, organizationId: o, leadId, messageId: null, state: "queued", reason: null, attempts: 0, holdReason: null, holdHash: null, leaseUntil: null, updatedAt: at });
      return fresh.length;
    },
    removeMember: async (o: string, id: number, leadId: number) => {
      const i = members.findIndex((m) => m.organizationId === o && m.campaignId === id && m.leadId === leadId);
      if (i < 0) return "missing";
      if (["sent", "sending"].includes(msg(members[i].messageId)?.status)) return "sent";
      members.splice(i, 1); return "removed";
    },
    members: async (o: string, id: number) => members.filter((m) => m.organizationId === o && m.campaignId === id).map(view),
    memberFacts: async (o: string) => members.filter((m) => m.organizationId === o).map((m) => ({ campaignId: m.campaignId, state: m.state, messageStatus: msg(m.messageId)?.status ?? null, outcomes: [], interested: false })),
    ownLeadIds: async (o: string, ids: number[]) => ids.filter((id) => leads.some((l) => l.id === id && l.org === o && !l.archived)),
    audience: async (o: string) => leads.filter((l) => l.org === o).map((l) => ({ id: l.id, companyName: l.companyName, domain: null, industry: null, location: null, status: l.status, source: l.source, contactName: null, hasEmail: true, doNotContact: l.doNotContact, hasUnsent: false, inCampaign: campaigns.find((c) => c.status === "active" && members.some((m) => m.campaignId === c.id && m.leadId === l.id))?.name ?? null })),
    relink: async () => {},
    setPreparing: async (o: string, id: number, x: any) => {
      const c = await store.get(o, id); if (!c || c.status !== "active") return null;
      c.preparing = x.on; if (x.userId !== undefined) c.prepareUserId = x.userId; c.prepareStop = x.stop ?? null;
      if (x.requeueFailed) for (const m of members) if (m.campaignId === id && m.state === "failed") Object.assign(m, { state: "queued", reason: null, attempts: 0 });
      return c;
    },
    setSending: async (o: string, id: number, x: any) => {
      const c = await store.get(o, id); if (!c || c.status !== "active") return null;
      c.sending = x.on; if (x.userId !== undefined) c.senderUserId = x.userId; c.sendStop = x.stop ?? null; if (x.nextSendAt !== undefined) c.nextSendAt = x.nextSendAt; c.leaseUntil = null;
      return c;
    },
    claimDraft: async (at: Date, lease: number) => {
      const m = members.find((x) => x.state === "queued" && (!x.leaseUntil || x.leaseUntil < at) && campaigns.some((c) => c.id === x.campaignId && c.preparing && c.status === "active"));
      if (!m) return null;
      m.leaseUntil = new Date(at.getTime() + lease); m.attempts++;
      return { member: { ...m }, campaign: { ...campaigns.find((c) => c.id === m.campaignId) } };
    },
    settleMember: async (id: number, patch: any) => { Object.assign(members.find((m) => m.id === id), patch, { leaseUntil: null }); },
    finishPreparing: async () => { let n = 0; for (const c of campaigns) if (c.preparing && !members.some((m) => m.campaignId === c.id && m.state === "queued")) { c.preparing = false; c.prepareStop = null; n++; } return n; },
    claimSend: async (at: Date, lease: number) => {
      const c = campaigns.find((x) => x.sending && x.status === "active" && (!x.nextSendAt || x.nextSendAt <= at) && (!x.leaseUntil || x.leaseUntil < at));
      if (!c) return null;
      c.leaseUntil = new Date(at.getTime() + lease); return { ...c };
    },
    releaseSend: async (id: number, x: any) => { const c = campaigns.find((y) => y.id === id); c.leaseUntil = null; if (x.nextSendAt !== undefined) c.nextSendAt = x.nextSendAt; },
    nextApproved: async (o: string, id: number) => {
      for (const m of members.filter((x) => x.organizationId === o && x.campaignId === id && x.state === "drafted")) {
        const lm = msg(m.messageId);
        if (lm?.status === "approved" && m.holdHash !== lm.bodyHash) return { memberId: m.id, leadId: m.leadId, messageId: lm.id, bodyHash: lm.bodyHash, body: lm.body };
      }
      return null;
    },
    sendFacts: async (o: string, id: number, since: Date) => {
      const sent = members.filter((m) => m.organizationId === o && m.campaignId === id).map((m) => msg(m.messageId)).filter((lm) => lm?.status === "sent");
      return { sentSince: sent.filter((lm) => lm.sentAt >= since).length, sent: sent.length, bounced: sent.filter((lm) => events.some((e) => e.messageId === lm.id && e.kind === "bounced")).length };
    },
    unsentMessageId: async (o: string, leadId: number) => messages.filter((m) => m.org === o && m.leadId === leadId && ["draft", "approved", "sending"].includes(m.status)).pop()?.id ?? null,
    setDraftBody: async (o: string, id: number, from: string, body: string, hash: string) => { const m = msg(id); if (!m || m.org !== o || m.status !== "draft" || m.bodyHash !== from) return false; m.body = body; m.bodyHash = hash; return true; },
    draftBody: async (o: string, id: number) => { const m = msg(id); return m && m.org === o ? { subject: m.subject, body: m.body, bodyHash: m.bodyHash, status: m.status } : null; },
  };
  const deps: any = {
    store, ready: async () => true, now, random: () => 0, profileName: async (_o: string, id: number) => (id === 7 ? "Brands" : null),
    loadUser: async (o: string, id: string) => (users[id] && users[id].organizationId === o ? users[id] : null),
    draft: async (user: any, leadId: number) => {
      calls.draft.push({ by: user.id, leadId });
      const plan = draftPlan.get(leadId);
      if (plan === "throw") throw new Error("boom");
      if (plan) return plan;
      return { ok: true, message: { id: addMessage(leadId).id } };
    },
    send: async (user: any, messageId: number, bodyHash: string) => {
      calls.send.push({ by: user.id, messageId, bodyHash });
      const r = typeof sendPlan === "function" ? sendPlan(messageId) : sendPlan;
      if (r.ok && r.outcome === "sent") { const m = msg(messageId); m.status = "sent"; m.sentAt = now(); }
      return r;
    },
    unsubscribeUrl: (_o: string, messageId: number) => (linkBase ? `${linkBase}/u/${messageId}.sig` : null),
    queueEnabled: () => queueOn, log: (event: string, fields: any) => calls.log.push({ event, ...fields }), kick: () => { calls.kick++; },
  };
  const approve = (leadId: number) => { const m = messages.filter((x) => x.leadId === leadId).pop(); m.status = "approved"; m.approvedAt = now(); return m; };
  return {
    deps, calls, campaigns, members, messages, events, leads, users, draftPlan, addMessage, approve, msg,
    setLinks: (base: string | null) => { linkBase = base; },
    tick: (ms: number) => { clock += ms; }, setSend: (p: any) => { sendPlan = p; }, setQueue: (on: boolean) => { queueOn = on; },
    member: (leadId: number) => members.find((m) => m.leadId === leadId),
  };
}
const make = async (w: ReturnType<typeof world>, leadIds = [1, 2, 3], over: Record<string, unknown> = {}) => (await svc.createCampaign(ana, { name: "Diwali", leadIds, ...over }, w.deps) as any).campaign.id as number;
/** A campaign whose every lead has a draft with the footer on it. */
async function prepared(w: ReturnType<typeof world>, leadIds = [1, 2, 3]) {
  const id = await make(w, leadIds);
  await svc.startPreparing(ana, id, w.deps);
  for (let i = 0; i < leadIds.length; i++) await svc.draftStep(w.deps);
  return id;
}

describe("the opt-out line", () => {
  it("does not itself read as an opt-out, so a reply that quotes it can't put a friendly person on the do-not-contact list", () => {
    expect(classifyReply({ kind: "reply", subject: "Re: Hello", text: OPT_OUT_LINE } as any)).not.toBe("opt_out");
    expect(classifyReply({ kind: "reply", subject: "Re: Hello", text: `Sounds good, let's talk next week.\n\n> ${OPT_OUT_LINE}` } as any)).toBe("interested");
    // And a person who does want out is still heard.
    expect(classifyReply({ kind: "reply", subject: "Re: Hello", text: "Please stop, this isn't relevant." } as any)).toBe("opt_out");
  });
});

describe("making a campaign", () => {
  it("groups the workspace's own leads, silently leaving out ids that aren't its own", async () => {
    const w = world();
    const r: any = await svc.createCampaign(ana, { name: " Diwali  push ", leadIds: [1, 2, 9, 404], profileId: 7, footerNote: "Pixel Studio, Pune" }, w.deps);
    expect(r).toMatchObject({ ok: true, added: 2, left: 2, campaign: { name: "Diwali push", profileName: "Brands", footerNote: "Pixel Studio, Pune", preparing: false, sending: false, counts: { members: 2, queued: 2 } } });
    expect(w.members.map((m) => m.leadId)).toEqual([1, 2]);
    expect(w.calls.draft).toEqual([]); // creating one writes nothing and spends nothing
  });
  it("refuses a campaign with no lead of its own, bad input, and one more than the cap", async () => {
    const w = world();
    expect(await svc.createCampaign(ana, { name: "x", leadIds: [9] }, w.deps)).toMatchObject({ ok: false, status: 400 });
    expect(await svc.createCampaign(ana, { name: "", leadIds: [1] }, w.deps)).toMatchObject({ ok: false, status: 400, message: "Give the campaign a name." });
    expect(await svc.createCampaign(ana, { name: "x", leadIds: [1], dailyLimit: 500 }, w.deps)).toMatchObject({ ok: false, status: 400 });
    expect(w.campaigns).toEqual([]);
    for (let i = 0; i < MAX_CAMPAIGNS; i++) expect((await svc.createCampaign(ana, { name: `C${i}`, leadIds: [1] }, w.deps)).ok).toBe(true);
    expect(await svc.createCampaign(ana, { name: "one more", leadIds: [1] }, w.deps)).toMatchObject({ ok: false, status: 409, code: "too_many" });
  });
  it("a profile that isn't the workspace's own is not attached", async () => {
    const w = world();
    expect(await svc.createCampaign(ana, { name: "x", leadIds: [1], profileId: 99 }, w.deps)).toMatchObject({ ok: true, campaign: { profileName: null } });
    expect(w.campaigns[0].profileId).toBeNull();
  });
  it("the audience says which leads can't be picked, and why", async () => {
    const w = world();
    w.leads[1].doNotContact = true;
    await make(w, [3]);
    const r: any = await svc.audience(ana, {}, w.deps);
    expect(r.leads.map((l: any) => [l.id, l.blocked])).toEqual([[1, null], [2, "Marked do-not-contact"], [3, 'Already in "Diwali"'], [4, null], [5, null]]);
  });
});

describe("who may do what", () => {
  it("a viewer reads and changes nothing; another workspace finds nothing", async () => {
    const w = world();
    const id = await make(w);
    expect(await svc.listCampaigns(viewer, w.deps)).toMatchObject({ ok: true, campaigns: [{ name: "Diwali" }] });
    expect(await svc.getCampaign(viewer, id, w.deps)).toMatchObject({ ok: true });
    for (const r of [await svc.createCampaign(viewer, { name: "v", leadIds: [1] }, w.deps), await svc.audience(viewer, {}, w.deps), await svc.updateCampaign(viewer, id, { name: "v" }, w.deps), await svc.addMembers(viewer, id, { leadIds: [4] }, w.deps), await svc.removeMember(viewer, id, 1, w.deps), await svc.startPreparing(viewer, id, w.deps), await svc.stopPreparing(viewer, id, w.deps), await svc.startSending(viewer, id, w.deps), await svc.pauseSending(viewer, id, w.deps), await svc.archiveCampaign(viewer, id, w.deps)])
      expect(r).toMatchObject({ ok: false, status: 403 });
    expect(await svc.listCampaigns(bob, w.deps)).toMatchObject({ ok: true, campaigns: [] });
    for (const r of [await svc.getCampaign(bob, id, w.deps), await svc.updateCampaign(bob, id, { name: "mine" }, w.deps), await svc.addMembers(bob, id, { leadIds: [9] }, w.deps), await svc.removeMember(bob, id, 1, w.deps), await svc.startPreparing(bob, id, w.deps), await svc.stopPreparing(bob, id, w.deps), await svc.startSending(bob, id, w.deps), await svc.pauseSending(bob, id, w.deps), await svc.archiveCampaign(bob, id, w.deps)])
      expect(r).toMatchObject({ ok: false, status: 404, code: "not_found" });
    expect(w.campaigns[0]).toMatchObject({ name: "Diwali", status: "active", preparing: false, sending: false });
    expect(w.members).toHaveLength(3);
  });
  it("a coworker's look at a campaign changes nothing: no tidy-up, no job woken, even mid-drafting", async () => {
    const w = world();
    const id = await make(w);
    await svc.startPreparing(ana, id, w.deps);
    const kicksBefore = w.calls.kick;
    let relinked = 0;
    const deps = { ...w.deps, store: { ...w.deps.store, relink: async () => { relinked++; } } };
    const quiet: any = await svc.getCampaign(ana, id, deps, { readOnly: true });
    expect(quiet).toMatchObject({ ok: true, campaign: { preparing: true, counts: { members: 3, queued: 3 } } });
    expect([relinked, w.calls.kick - kicksBefore]).toEqual([0, 0]);
    // The page's own read does both.
    await svc.getCampaign(ana, id, deps);
    expect([relinked, w.calls.kick - kicksBefore]).toEqual([1, 1]);
  });
  it("on a server without the tables it says so, and the job does nothing", async () => {
    const w = world();
    const deps = { ...w.deps, ready: async () => false };
    for (const r of [await svc.listCampaigns(ana, deps), await svc.createCampaign(ana, { name: "x", leadIds: [1] }, deps), await svc.getCampaign(ana, 1, deps), await svc.startPreparing(ana, 1, deps), await svc.startSending(ana, 1, deps)])
      expect(r).toMatchObject({ ok: false, status: 503, code: "CAMPAIGNS_NOT_SETUP" });
    expect(await svc.draftStep(deps)).toBe("idle");
    expect(await svc.sendStep(deps)).toBe("idle");
    expect(await svc.draftStep({ ...w.deps, ready: async () => { throw new Error("db down"); } })).toBe("idle");
  });
  it("members can be added up to the cap and taken out until their message is sent", async () => {
    const w = world();
    const id = await make(w, [1, 2]);
    expect(await svc.addMembers(ana, id, { leadIds: [2, 3, 9] }, w.deps)).toMatchObject({ ok: true, added: 1 });
    expect(await svc.removeMember(ana, id, 3, w.deps)).toMatchObject({ ok: true });
    expect(await svc.removeMember(ana, id, 3, w.deps)).toMatchObject({ ok: false, status: 404 });
    const m = w.addMessage(1, { status: "sent", sentAt: T0 });
    Object.assign(w.member(1), { state: "drafted", messageId: m.id });
    expect(await svc.removeMember(ana, id, 1, w.deps)).toMatchObject({ ok: false, status: 409, code: "already_sent" });
    expect(w.members.map((x) => x.leadId)).toEqual([1, 2]);
  });
  it("an archived campaign can't be changed or restarted, and archiving stops both jobs", async () => {
    const w = world();
    const id = await prepared(w, [1]);
    w.approve(1);
    await svc.startSending(ana, id, w.deps);
    expect(await svc.archiveCampaign(ana, id, w.deps)).toMatchObject({ ok: true, campaign: { status: "archived", sending: false, preparing: false } });
    for (const r of [await svc.updateCampaign(ana, id, { name: "x" }, w.deps), await svc.addMembers(ana, id, { leadIds: [4] }, w.deps), await svc.startPreparing(ana, id, w.deps), await svc.startSending(ana, id, w.deps)])
      expect(r).toMatchObject({ ok: false, status: 409, code: "archived" });
    expect(await svc.sendStep(w.deps)).toBe("idle");
    expect(w.calls.send).toEqual([]);
  });
});

describe("preparing drafts", () => {
  it("nothing is written until someone presses Prepare; then one lead at a time, as that person, each draft with the footer on it", async () => {
    const w = world();
    const id = await make(w, [1, 2], { footerNote: "Pixel Studio, Pune" });
    expect(await svc.draftStep(w.deps)).toBe("idle");
    expect(await svc.startPreparing(ana, id, w.deps)).toMatchObject({ ok: true, waiting: 2, campaign: { preparing: true } });
    expect(w.calls.kick).toBe(1);
    expect(await svc.draftStep(w.deps)).toBe("drafted");
    expect(w.calls.draft).toEqual([{ by: "ana", leadId: 1 }]);
    const first = w.msg(w.member(1).messageId);
    expect(first.body).toBe(withFooter(BODY, "Pixel Studio, Pune"));
    expect(first.bodyHash).toBe(hashDraft("Hello", first.body)); // the hash is of the text WITH the footer: that is what gets approved
    expect(first.status).toBe("draft"); // prepared, never approved by the job
    expect(await svc.draftStep(w.deps)).toBe("drafted");
    expect(w.campaigns[0].preparing).toBe(false); // nobody left waiting: the job switches itself off
    expect(await svc.draftStep(w.deps)).toBe("idle");
    const got: any = await svc.getCampaign(ana, id, w.deps);
    expect(got.campaign.counts).toMatchObject({ members: 2, queued: 0, draft: 2, approved: 0, sent: 0 });
    expect(got.members.map((m: any) => m.stage)).toEqual(["draft", "draft"]);
  });
  it("when the server can sign links, each draft ends with ITS OWN unsubscribe link, after the opt-out line, and is still sendable", async () => {
    const w = world();
    w.setLinks("https://www.dealinsec.com");
    const id = await make(w, [1, 2], { footerNote: "Pixel Studio, Pune" });
    await svc.startPreparing(ana, id, w.deps);
    await svc.draftStep(w.deps); await svc.draftStep(w.deps);
    const [m1, m2] = [w.msg(w.member(1).messageId), w.msg(w.member(2).messageId)];
    expect(m1.body).toBe(`${BODY}\n\nPixel Studio, Pune\n${OPT_OUT_LINE}\nTo stop these emails: https://www.dealinsec.com/u/${m1.id}.sig`);
    expect(m2.body.endsWith(`/u/${m2.id}.sig`)).toBe(true);
    expect(m1.bodyHash).toBe(hashDraft("Hello", m1.body)); // the link is part of what gets approved
    expect((await svc.listCampaigns(ana, w.deps) as any).unsubscribeLinks).toBe(true);
    // The footer with its link doesn't read as an opt-out when a reply quotes it.
    expect(classifyReply({ kind: "reply", subject: "Re: Hello", text: `Yes, let's talk.\n\n> ${OPT_OUT_LINE}\n> To stop these emails: https://www.dealinsec.com/u/${m1.id}.sig` } as any)).toBe("interested");
    w.approve(1);
    await svc.startSending(ana, id, w.deps);
    expect(await svc.sendStep(w.deps)).toBe("sent");
  });
  it("without a secret there is no link, and the page is told so", async () => {
    const w = world();
    await make(w, [1]);
    expect((await svc.listCampaigns(ana, w.deps) as any).unsubscribeLinks).toBe(false);
  });
  it("a lead that already has a message waiting keeps it: no second draft, no model call", async () => {
    const w = world();
    const id = await make(w, [1]);
    const mine = w.addMessage(1, { body: "My own words to Asha, written by hand before the campaign existed, long enough." });
    await svc.startPreparing(ana, id, w.deps);
    expect(await svc.draftStep(w.deps)).toBe("adopted");
    expect(w.calls.draft).toEqual([]);
    expect(w.member(1)).toMatchObject({ state: "drafted", messageId: mine.id });
    expect(w.msg(mine.id).body.endsWith(OPT_OUT_LINE)).toBe(true); // still a draft, so it gets the footer too
  });
  it("a lead with message versions still to choose from is set aside for the person, and picked up again by Prepare", async () => {
    const w = world();
    const id = await make(w, [1, 2]);
    w.draftPlan.set(1, { ok: false, code: "draft_exists" }); // versions are waiting: there is no draft to adopt
    await svc.startPreparing(ana, id, w.deps);
    expect([await svc.draftStep(w.deps), await svc.draftStep(w.deps)]).toEqual(["failed", "drafted"]);
    expect((await svc.getCampaign(ana, id, w.deps) as any).members[0]).toMatchObject({ stage: "failed", note: "It has message versions waiting. Choose one on the lead, then press Prepare drafts again" });
    w.draftPlan.delete(1);
    w.addMessage(1); // the person chose one: now it is a draft
    expect(await svc.startPreparing(ana, id, w.deps)).toMatchObject({ ok: true, waiting: 1 });
    expect(await svc.draftStep(w.deps)).toBe("adopted");
  });
  it("an approved message that is adopted is left exactly as it was approved", async () => {
    const w = world();
    const id = await make(w, [1]);
    const mine = w.addMessage(1, { status: "approved", approvedAt: T0 });
    await svc.startPreparing(ana, id, w.deps);
    expect(await svc.draftStep(w.deps)).toBe("adopted");
    expect(w.msg(mine.id)).toMatchObject({ body: BODY, status: "approved", bodyHash: hashDraft("Hello", BODY) });
  });
  it("a lead that can't be written to is skipped with its reason, and the rest go on", async () => {
    const w = world();
    const id = await make(w, [1, 2, 3]);
    w.draftPlan.set(1, { ok: false, code: "no_address" });
    w.draftPlan.set(2, { ok: false, code: "do_not_contact" });
    await svc.startPreparing(ana, id, w.deps);
    expect([await svc.draftStep(w.deps), await svc.draftStep(w.deps), await svc.draftStep(w.deps)]).toEqual(["skipped", "skipped", "drafted"]);
    const got: any = await svc.getCampaign(ana, id, w.deps);
    expect(got.members.map((m: any) => [m.stage, m.note])).toEqual([["skipped", "No email address on the lead or its site"], ["skipped", "Marked do-not-contact"], ["draft", null]]);
    expect(got.campaign).toMatchObject({ preparing: false, counts: { skipped: 2, draft: 1 } });
  });
  it("when the plan's drafts run out the job stops and says why; the lead it was on waits, uncounted", async () => {
    const w = world();
    const id = await make(w, [1, 2, 3]);
    w.draftPlan.set(2, { ok: false, code: "draft_allowance" });
    await svc.startPreparing(ana, id, w.deps);
    expect([await svc.draftStep(w.deps), await svc.draftStep(w.deps), await svc.draftStep(w.deps)]).toEqual(["drafted", "stopped", "idle"]);
    expect(w.calls.draft.map((c) => c.leadId)).toEqual([1, 2]); // lead 3 was never attempted
    expect(w.member(2)).toMatchObject({ state: "queued", attempts: 0 });
    const got: any = await svc.getCampaign(ana, id, w.deps);
    expect(got.campaign).toMatchObject({ preparing: false, prepareStop: "draft_allowance", prepareStopLabel: "Your plan's AI drafts for this 30-day period are used up", counts: { draft: 1, queued: 2 } });
    // Pressing Prepare again resumes from where it stopped.
    w.draftPlan.delete(2);
    await svc.startPreparing(ana, id, w.deps);
    expect([await svc.draftStep(w.deps), await svc.draftStep(w.deps)]).toEqual(["drafted", "drafted"]);
  });
  it("an outage is tried three times, then that lead is marked failed and the others go on; Prepare tries failed ones again", async () => {
    const w = world();
    const id = await make(w, [1, 2]);
    w.draftPlan.set(1, { ok: false, code: "model_unavailable" });
    await svc.startPreparing(ana, id, w.deps);
    const out: string[] = [];
    for (let i = 0; i < 6 && w.campaigns[0].preparing; i++) { out.push(await svc.draftStep(w.deps)); w.tick(svc.DRAFT_LEASE_MS + 1); }
    expect(out.filter((o) => o === "retry")).toHaveLength(2);
    expect(out).toContain("failed");
    expect(out).toContain("drafted");
    expect(w.member(1)).toMatchObject({ state: "failed", reason: "model_unavailable" });
    expect(w.campaigns[0].preparing).toBe(false);
    w.draftPlan.delete(1);
    expect(await svc.startPreparing(ana, id, w.deps)).toMatchObject({ ok: true, waiting: 1 });
    expect(await svc.draftStep(w.deps)).toBe("drafted");
  });
  it("if the drafting itself blows up, nothing is lost: the lead is tried again once its lease runs out", async () => {
    const w = world();
    const id = await make(w, [1]);
    w.draftPlan.set(1, "throw");
    await svc.startPreparing(ana, id, w.deps);
    expect(await svc.draftStep(w.deps)).toBe("retry");
    expect(await svc.draftStep(w.deps)).toBe("idle"); // leased: a second pass doesn't take the same lead
    w.draftPlan.delete(1); w.tick(svc.DRAFT_LEASE_MS + 1);
    expect(await svc.draftStep(w.deps)).toBe("drafted");
    void id;
  });
  it("stops when the person who started it has left or lost the right, without drafting", async () => {
    const w = world();
    const id = await make(w, [1]);
    await svc.startPreparing(ana, id, w.deps);
    delete w.users.ana;
    expect(await svc.draftStep(w.deps)).toBe("stopped");
    expect(w.calls.draft).toEqual([]);
    expect(w.campaigns[0]).toMatchObject({ preparing: false, prepareStop: "user_unavailable" });
    expect(w.member(1)).toMatchObject({ state: "queued", attempts: 0 });
  });
  it("a draft too long to carry the footer keeps its text and says so", async () => {
    const w = world();
    const id = await make(w, [1]);
    const long = "x".repeat(1490);
    w.draftPlan.set(1, undefined);
    w.deps.draft = async (_u: any, leadId: number) => ({ ok: true, message: { id: w.addMessage(leadId, { body: long }).id } });
    await svc.startPreparing(ana, id, w.deps);
    expect(await svc.draftStep(w.deps)).toBe("drafted");
    expect(w.msg(w.member(1).messageId).body).toBe(long);
    expect((await svc.getCampaign(ana, id, w.deps) as any).members[0]).toMatchObject({ stage: "draft", note: "The message is too long to carry the opt-out line. Shorten it" });
  });
  it("Prepare with nobody waiting is refused; Stop stops", async () => {
    const w = world();
    const id = await prepared(w, [1]);
    expect(await svc.startPreparing(ana, id, w.deps)).toMatchObject({ ok: false, status: 409, code: "nothing_to_prepare" });
    await svc.addMembers(ana, id, { leadIds: [2, 3] }, w.deps);
    await svc.startPreparing(ana, id, w.deps);
    expect(await svc.stopPreparing(ana, id, w.deps)).toMatchObject({ ok: true, campaign: { preparing: false, prepareStop: "stopped", prepareStopLabel: "Stopped by you" } });
    expect(await svc.draftStep(w.deps)).toBe("idle");
  });
});

describe("the sending queue", () => {
  it("is off unless the server switch is on, and never starts with nothing approved", async () => {
    const w = world();
    const id = await prepared(w, [1]);
    expect(await svc.startSending(ana, id, w.deps)).toMatchObject({ ok: false, status: 409, code: "nothing_approved" });
    w.approve(1);
    w.setQueue(false);
    expect(await svc.startSending(ana, id, w.deps)).toMatchObject({ ok: false, status: 503, code: "queue_off" });
    expect(await svc.sendStep(w.deps)).toBe("idle");
    expect(w.calls.send).toEqual([]);
    expect(svc.queueSwitch({} as any)).toBe(false);
    expect(svc.queueSwitch({ CAMPAIGN_SENDING_ENABLED: "1" } as any)).toBe(false);
    expect(svc.queueSwitch({ CAMPAIGN_SENDING_ENABLED: "true" } as any)).toBe(true);
  });
  it("sends only approved messages, one per pass, as the person who started it, then waits out the gap", async () => {
    const w = world();
    const id = await prepared(w, [1, 2, 3]);
    const a1 = w.approve(1), a2 = w.approve(2); // lead 3 stays a draft
    expect(await svc.startSending(ana, id, w.deps)).toMatchObject({ ok: true, campaign: { sending: true } });
    expect(await svc.sendStep(w.deps)).toBe("sent");
    expect(w.calls.send).toEqual([{ by: "ana", messageId: a1.id, bodyHash: a1.bodyHash }]);
    expect(await svc.sendStep(w.deps)).toBe("idle"); // the gap hasn't passed
    w.tick(179_000);
    expect(await svc.sendStep(w.deps)).toBe("idle");
    w.tick(2_000);
    expect(await svc.sendStep(w.deps)).toBe("sent");
    expect(w.calls.send.map((c) => c.messageId)).toEqual([a1.id, a2.id]);
    // The draft nobody approved is never sent: the queue waits for a person.
    w.tick(svc.SEND_LEASE_MS);
    expect(await svc.sendStep(w.deps)).toBe("waiting");
    expect(w.calls.send).toHaveLength(2);
    expect(w.msg(w.member(3).messageId).status).toBe("draft");
    expect(w.campaigns[0].sending).toBe(true);
  });
  it("finishes by itself when everything approved has gone and nothing is waiting", async () => {
    const w = world();
    const id = await prepared(w, [1]);
    w.approve(1);
    await svc.startSending(ana, id, w.deps);
    expect(await svc.sendStep(w.deps)).toBe("sent");
    w.tick(600_000);
    expect(await svc.sendStep(w.deps)).toBe("done");
    expect((await svc.getCampaign(ana, id, w.deps) as any).campaign).toMatchObject({ sending: false, sendStop: "done", sendStopLabel: "Everything approved has been sent", counts: { sent: 1 }, rates: { reply: 0, bounce: 0 } });
  });
  it("never sends a message whose opt-out line was removed: it is held, with the reason, and the next one goes", async () => {
    const w = world();
    const id = await prepared(w, [1, 2]);
    const m1 = w.msg(w.member(1).messageId);
    m1.body = BODY; m1.bodyHash = hashDraft("Hello", BODY); // the person edited the footer away, then approved
    w.approve(1); const a2 = w.approve(2);
    await svc.startSending(ana, id, w.deps);
    expect(await svc.sendStep(w.deps)).toBe("held");
    expect(w.calls.send).toEqual([]);
    expect(await svc.sendStep(w.deps)).toBe("sent");
    expect(w.calls.send.map((c) => c.messageId)).toEqual([a2.id]);
    const got: any = await svc.getCampaign(ana, id, w.deps);
    expect(got.members[0]).toMatchObject({ stage: "approved", note: "The opt-out line was removed. Put it back to send from the queue" });
    // Put back and approved again (a new text, so a new hash): it is no longer held.
    m1.body = withFooter(BODY, ""); m1.bodyHash = hashDraft("Hello", m1.body);
    w.tick(600_000);
    expect(await svc.sendStep(w.deps)).toBe("sent");
    expect(w.calls.send.map((c) => c.messageId)).toEqual([a2.id, m1.id]);
  });
  it("respects the campaign's daily limit, counted over the last 24 hours", async () => {
    const w = world();
    const id = await prepared(w, [1, 2, 3]);
    await svc.updateCampaign(ana, id, { dailyLimit: 2 }, w.deps);
    w.approve(1); w.approve(2); w.approve(3);
    await svc.startSending(ana, id, w.deps);
    expect(await svc.sendStep(w.deps)).toBe("sent"); w.tick(300_000);
    expect(await svc.sendStep(w.deps)).toBe("sent"); w.tick(300_000);
    expect(await svc.sendStep(w.deps)).toBe("limit");
    expect(w.calls.send).toHaveLength(2);
    expect(w.campaigns[0].sending).toBe(true); // waiting for tomorrow, not stopped
    w.tick(25 * 3_600_000);
    expect(await svc.sendStep(w.deps)).toBe("sent");
  });
  it("a problem with one message holds that message only; a problem with the mailbox or a limit pauses everything", async () => {
    const w = world();
    const id = await prepared(w, [1, 2, 3]);
    const a1 = w.approve(1); w.approve(2); w.approve(3);
    await svc.startSending(ana, id, w.deps);
    w.setSend((mid: number) => (mid === a1.id ? { ok: false, code: "suppressed" } : { ok: true, outcome: "sent" }));
    expect(await svc.sendStep(w.deps)).toBe("held");
    expect(await svc.sendStep(w.deps)).toBe("sent");
    expect(w.member(1)).toMatchObject({ holdReason: "suppressed", holdHash: a1.bodyHash });
    w.tick(600_000);
    w.setSend({ ok: false, code: "mailbox_reconnect" });
    expect(await svc.sendStep(w.deps)).toBe("paused");
    expect(w.campaigns[0]).toMatchObject({ sending: false, sendStop: "mailbox_reconnect" });
    w.tick(600_000);
    expect(await svc.sendStep(w.deps)).toBe("idle"); // paused means paused: nothing more goes until a person restarts it
    expect((await svc.getCampaign(ana, id, w.deps) as any).campaign.sendStopLabel).toBe("Reconnect your Gmail in Settings");
  });
  it("pauses on the plan's limit, the mailbox's daily cap, and a code it has never seen", async () => {
    for (const code of ["plan_send_limit", "daily_cap", "something_new"]) {
      const w = world();
      const id = await prepared(w, [1]);
      w.approve(1);
      await svc.startSending(ana, id, w.deps);
      w.setSend({ ok: false, code });
      expect(await svc.sendStep(w.deps), code).toBe("paused");
      expect(w.campaigns[0].sending, code).toBe(false);
      void id;
    }
  });
  it("a send that may or may not have gone out pauses the queue and is never tried again by it", async () => {
    const w = world();
    const id = await prepared(w, [1, 2]);
    w.approve(1); w.approve(2);
    await svc.startSending(ana, id, w.deps);
    w.setSend({ ok: true, outcome: "uncertain" });
    expect(await svc.sendStep(w.deps)).toBe("paused");
    expect(w.campaigns[0]).toMatchObject({ sending: false, sendStop: "uncertain" });
    expect(w.calls.send).toHaveLength(1);
    w.setSend({ ok: true, outcome: "failed", reconnect: true });
    await svc.startSending(ana, id, w.deps);
    expect(await svc.sendStep(w.deps)).toBe("paused");
    expect(w.campaigns[0].sendStop).toBe("mailbox_reconnect");
    void id;
  });
  it("a provider hiccup is simply tried later, with the queue still on", async () => {
    const w = world();
    const id = await prepared(w, [1]);
    w.approve(1);
    await svc.startSending(ana, id, w.deps);
    w.setSend({ ok: false, code: "provider_unavailable" });
    expect(await svc.sendStep(w.deps)).toBe("later");
    expect(w.campaigns[0].sending).toBe(true);
    expect(await svc.sendStep(w.deps)).toBe("idle");
    w.setSend({ ok: true, outcome: "sent" }); w.tick(600_000);
    expect(await svc.sendStep(w.deps)).toBe("sent");
    void id;
  });
  it("stops itself when messages bounce", async () => {
    const w = world();
    const id = await prepared(w, [1, 2, 3, 4]);
    for (const l of [1, 2, 3, 4]) w.approve(l);
    await svc.startSending(ana, id, w.deps);
    for (let i = 0; i < 3; i++) { expect(await svc.sendStep(w.deps)).toBe("sent"); w.tick(600_000); }
    for (const l of [1, 2]) w.events.push({ messageId: w.member(l).messageId, kind: "bounced" });
    expect(await svc.sendStep(w.deps)).toBe("paused");
    expect(w.calls.send).toHaveLength(3); // the fourth was not sent
    expect((await svc.getCampaign(ana, id, w.deps) as any).campaign).toMatchObject({ sending: false, sendStop: "bounce_rate", counts: { sent: 3, bounced: 2, approved: 1 }, rates: { bounce: 66.7 } });
  });
  it("pauses when the switch is turned off mid-campaign, and when the sender has left", async () => {
    const w = world();
    const id = await prepared(w, [1, 2]);
    w.approve(1); w.approve(2);
    await svc.startSending(ana, id, w.deps);
    w.setQueue(false);
    expect(await svc.sendStep(w.deps)).toBe("paused");
    expect(w.campaigns[0].sendStop).toBe("queue_off");
    w.setQueue(true);
    await svc.startSending(ana, id, w.deps);
    delete w.users.ana;
    expect(await svc.sendStep(w.deps)).toBe("paused");
    expect(w.campaigns[0].sendStop).toBe("not_member");
    expect(w.calls.send).toEqual([]);
  });
  it("Pause stops it at once; two passes never send for the same campaign at the same time", async () => {
    const w = world();
    const id = await prepared(w, [1, 2]);
    w.approve(1); w.approve(2);
    await svc.startSending(ana, id, w.deps);
    let inFlight = 0, most = 0;
    w.deps.send = async (_u: any, messageId: number) => { inFlight++; most = Math.max(most, inFlight); await new Promise((r) => setTimeout(r, 5)); const m = w.msg(messageId); m.status = "sent"; m.sentAt = w.deps.now(); inFlight--; return { ok: true, outcome: "sent" }; };
    const out = await Promise.all([svc.sendStep(w.deps), svc.sendStep(w.deps), svc.sendStep(w.deps)]);
    expect(out.filter((o) => o === "sent")).toHaveLength(1);
    expect(most).toBe(1);
    w.tick(600_000);
    expect(await svc.pauseSending(ana, id, w.deps)).toMatchObject({ ok: true, campaign: { sending: false, sendStop: "paused", sendStopLabel: "Paused by you" } });
    expect(await svc.sendStep(w.deps)).toBe("idle");
  });
});
