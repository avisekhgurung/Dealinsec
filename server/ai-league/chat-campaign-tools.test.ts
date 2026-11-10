/**
 * The chat tools that start the new work: what the approval card shows, what they refuse, and that the coworkers'
 * own instructions say who may do what. Fake starters and lookups; no model, no database.
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
import { LEAGUE_LIMITS } from "@shared/ai-league";
import { BOT_TOOLS, handoffTool, mikaCampaignTool, personaPrompt, startTaskTool } from "./chat";

const OWNER = { id: "u1", organizationId: "org-1", orgRole: "OWNER", memberStatus: "active" } as any;
const READER = { id: "u2", organizationId: "org-1", orgRole: "VIEWER", memberStatus: "active" } as any;
const ctx = (runId = "r1") => ({ user: OWNER, sessionId: "s", runId, userText: "", userMessages: [], progress: () => {} }) as any;
function starter() {
  const starts: any[] = [];
  const start = async (user: any, task: any, input: any, idemKey: string) => { starts.push({ user: user.id, task, input, idemKey }); return { ok: true as const, run: { id: "lr_x" }, existing: false }; };
  return { start, starts };
}
const profiles = async (_u: any, id: number) => (id === 7 ? "Brands that need growth" : null);

describe("Nibo's research from a saved profile", () => {
  it("the approval card names the profile and the kind of company, and still always asks first", async () => {
    const { start } = starter();
    const p: any = await startTaskTool("nibo", start, profiles).prepare!(ctx(), { request: "Edtech companies from my Brands profile", saveLeads: true, maxLeads: 3, profileId: 7, kind: "edtech company" });
    expect(p).toMatchObject({ ok: true, forceApproval: true });
    expect(p.preview.lines).toContainEqual({ label: "From your saved profile", value: "Brands that need growth · edtech company" });
    // What is started carries the id, not the name: the task reads the profile again itself.
    expect(p.args).toEqual({ request: "Edtech companies from my Brands profile", saveLeads: true, maxLeads: 3, profileId: 7, kind: "edtech company" });
  });
  it("a profile that isn't the person's is refused before any card is shown, with what to do instead", async () => {
    const { start, starts } = starter();
    for (const lookup of [profiles, async () => { throw new Error("db"); }]) {
      const p: any = await startTaskTool("nibo", start, lookup).prepare!(ctx(), { request: "Edtech companies from my profile", profileId: 99, kind: null });
      expect(p).toMatchObject({ ok: false, code: "profile_not_found" });
      expect(p.message).toMatch(/list_client_profiles/);
    }
    expect(starts).toEqual([]);
  });
  it("without a profile the card is what it was, and no lookup is made", async () => {
    const { start } = starter();
    let looked = 0;
    const p: any = await startTaskTool("nibo", start, async () => { looked++; return null; }).prepare!(ctx(), { request: "dentists in Siliguri", saveLeads: true, maxLeads: 3 });
    expect(p.ok).toBe(true);
    expect(p.preview.lines.map((l: any) => l.label)).toEqual(["Looking for", "Save to Leads"]);
    expect(looked).toBe(0);
  });
  it("a teammate handing research to Nibo gets the same check", async () => {
    const { start } = starter();
    const good: any = await handoffTool("mika", "nibo", start, profiles).prepare!(ctx(), { request: "Edtech companies from my Brands profile", profileId: 7, kind: null });
    expect(good.preview.lines).toContainEqual({ label: "From your saved profile", value: "Brands that need growth" });
    expect(await handoffTool("mika", "nibo", start, profiles).prepare!(ctx(), { request: "Edtech companies from my profile", profileId: 5, kind: null })).toMatchObject({ ok: false, code: "profile_not_found" });
  });
});

describe("Mika's campaign drafts tool", () => {
  const campaigns = async (_u: any, id: number) => (id === 5 ? { name: "Diwali", waiting: 6 } : null);
  it("always asks first, and the card says which campaign, how many leads, and what it uses", async () => {
    const { start } = starter();
    const tool = mikaCampaignTool(start, campaigns);
    const existing: any = await tool.prepare!(ctx(), { campaignId: 5 });
    expect(existing).toMatchObject({ ok: true, forceApproval: true, args: { campaignId: 5, name: "", leadIds: [], max: 10, runId: null } });
    expect(existing.preview.lines).toEqual([{ label: "Campaign", value: "Diwali" }, { label: "Leads waiting for a draft", value: "6" }]);
    expect(existing.preview.effects).toEqual(["Uses one of your plan's AI drafts for each draft written", "Writes drafts only: nothing is approved or sent", "Each draft waits in Client Radar → Campaigns for you"]);
    const fresh: any = await tool.prepare!(ctx(), { name: "D2C, November", leadIds: [3, 4, 9] });
    expect(fresh.preview.lines).toEqual([{ label: "New campaign", value: "D2C, November" }, { label: "Leads", value: "3 chosen lead(s)" }]);
    const auto: any = await tool.prepare!(ctx(), { max: 8 });
    expect(auto.preview.lines).toEqual([{ label: "New campaign", value: "Named for today" }, { label: "Leads", value: "Up to 8 of your newest open leads" }]);
    expect(auto.forceApproval).toBe(true);
  });
  it("with an existing campaign, leads named alongside it are dropped: it prepares that campaign, nothing else", async () => {
    const { start } = starter();
    const p: any = await mikaCampaignTool(start, campaigns).prepare!(ctx(), { campaignId: 5, leadIds: [1, 2] });
    expect(p.args).toEqual({ campaignId: 5, name: "", leadIds: [], max: 10, runId: null });
  });
  it("refuses a campaign that isn't open in the workspace, a viewer, and anything outside its limits", async () => {
    const { start, starts } = starter();
    const tool = mikaCampaignTool(start, campaigns);
    expect(await tool.prepare!(ctx(), { campaignId: 77 })).toMatchObject({ ok: false, code: "not_found" });
    expect(await mikaCampaignTool(start, async () => { throw new Error("db"); }).prepare!(ctx(), { campaignId: 5 })).toMatchObject({ ok: false, code: "not_found" });
    expect(tool.authorize(READER, {})).toMatch(/doesn't allow/);
    expect(tool.authorize(OWNER, {})).toBeNull();
    expect(tool.input.safeParse({ leadIds: Array.from({ length: LEAGUE_LIMITS.campaignLeads + 1 }, (_, i) => i + 1) }).success).toBe(false);
    expect(tool.input.safeParse({ max: 500 }).success).toBe(false);
    for (const extra of [{ send: true }, { approve: true }, { dailyLimit: 50 }]) expect(tool.input.safeParse(extra).success, JSON.stringify(extra)).toBe(false);
    expect(starts).toEqual([]);
  });
  it("executing starts Mika's campaign task as the signed-in person, once per chat run, and never claims it is done", async () => {
    const { start, starts } = starter();
    const out: any = await mikaCampaignTool(start, campaigns).execute!(ctx("agentrun-9"), { campaignId: null, name: "D2C", leadIds: [3], max: 10 });
    expect(starts).toEqual([{ user: "u1", task: "mika.campaign", input: { campaignId: null, name: "D2C", leadIds: [3], max: 10 }, idemKey: "mikacampaign:agentrun-9" }]);
    expect(out).toMatchObject({ ok: true, route: "/ai-league/mika?run=lr_x" });
    expect(out.summary).toMatch(/NOT finished yet/);
    expect(out.summary).toMatch(/nothing has been approved or sent/);
  });
  it("can take the companies a search saved to Leads; a campaign that exists or leads that are named come first", async () => {
    const { start } = starter();
    const tool = mikaCampaignTool(start, campaigns);
    const fromSearch: any = await tool.prepare!(ctx(), { runId: "pr_abc123def456" });
    expect(fromSearch.args).toEqual({ campaignId: null, name: "", leadIds: [], max: 10, runId: "pr_abc123def456" });
    expect(fromSearch.preview.lines).toEqual([{ label: "New campaign", value: "Named after the search" }, { label: "Leads", value: "The companies that search saved to Leads" }]);
    expect((await tool.prepare!(ctx(), { runId: "pr_abc123def456", leadIds: [4] }) as any).args).toMatchObject({ leadIds: [4], runId: null });
    expect((await tool.prepare!(ctx(), { runId: "pr_abc123def456", campaignId: 5 }) as any).args).toMatchObject({ campaignId: 5, runId: null });
    for (const bad of ["abc", "pr_", "pr_x y", "pr_../../etc", 7]) expect(tool.input.safeParse({ runId: bad }).success, String(bad)).toBe(false);
  });
  it("is a change that needs the person, not a read", () => {
    const { start } = starter();
    expect(mikaCampaignTool(start, campaigns).risk).toBe("SAFE_MUTATION");
  });
});

describe("Nibo hands a search's companies to Mika as a campaign", () => {
  const campaigns = async () => null;
  it("is its own tool, always asks first, and the card says who handed it over and whose report it will be", async () => {
    const { start, starts } = starter();
    const tool = mikaCampaignTool(start, campaigns, "nibo");
    expect(tool.name).toBe("handoff_nibo_to_mika_campaign");
    expect(tool.risk).toBe("SAFE_MUTATION");
    const p: any = await tool.prepare!(ctx(), { runId: "pr_abc123def456" });
    expect(p).toMatchObject({ ok: true, forceApproval: true, args: { runId: "pr_abc123def456", campaignId: null, leadIds: [] } });
    expect(p.preview.title).toBe("Nibo asks Mika: Campaign drafts");
    expect(p.preview.lines).toEqual([{ label: "Handed over by", value: "Nibo" }, { label: "New campaign", value: "Named after the search" }, { label: "Leads", value: "The companies that search saved to Leads" }]);
    expect(p.preview.effects).toContain("Mika's report appears in Mika's chat and in The Nest → Activity");
    expect(p.preview.effects).toContain("Writes drafts only: nothing is approved or sent");
    const out: any = await tool.execute!(ctx("agentrun-4"), p.args);
    expect(starts).toEqual([{ user: "u1", task: "mika.campaign", input: p.args, idemKey: "handoffcampaign:nibo:agentrun-4" }]);
    expect(out.route).toBe("/ai-league/mika?run=lr_x");
    expect(out.summary).toMatch(/Mika has started: Campaign drafts .*handed over by Nibo/);
    expect(out.summary).toMatch(/NOT finished yet, and nothing has been approved or sent/);
  });
  it("a viewer can't hand anything over, and it can't carry a send or an approval", () => {
    const { start } = starter();
    const tool = mikaCampaignTool(start, campaigns, "nibo");
    expect(tool.authorize(READER, {})).toMatch(/doesn't allow/);
    for (const extra of [{ send: true }, { approve: true }, { runId: "pr_abc123def456", dailyLimit: 50 }]) expect(tool.input.safeParse(extra).success, JSON.stringify(extra)).toBe(false);
  });
  it("Nibo is told when to use it, and that only companies saved to Leads can be in a campaign", () => {
    const nibo = personaPrompt("nibo", []);
    expect(nibo).toMatch(/handoff_nibo_to_mika_campaign/);
    expect(nibo).toMatch(/Only companies saved to Leads can be in a campaign/);
    expect(personaPrompt("mika", [])).not.toMatch(/handoff_nibo_to_mika_campaign/);
  });
});

describe("who is told what", () => {
  it("each coworker gets only the new tools that are theirs, and all of them are reads", () => {
    expect(BOT_TOOLS.nibo).toContain("list_client_profiles");
    expect(BOT_TOOLS.nibo).not.toContain("list_campaigns");
    for (const bot of ["mika", "zee"] as const) { expect(BOT_TOOLS[bot]).toContain("list_campaigns"); expect(BOT_TOOLS[bot]).toContain("get_campaign"); }
    expect(BOT_TOOLS.mika).not.toContain("list_client_profiles");
  });
  it("Nibo is told to search from a profile exactly; Mika that she never approves or starts sending; Zee that she never sees an email", () => {
    const nibo = personaPrompt("nibo", []), mika = personaPrompt("mika", []), zee = personaPrompt("zee", []);
    expect(nibo).toMatch(/list_client_profiles/);
    expect(nibo).toMatch(/must not add or change anything it says/);
    expect(mika).toMatch(/league_mika_campaign/);
    expect(mika).toMatch(/You never approve a draft and never start a campaign's sending/);
    expect(zee).toMatch(/You never see what an email says/);
    expect(mika).not.toMatch(/list_client_profiles/);
    expect(zee).not.toMatch(/league_mika_campaign/);
    for (const p of [nibo, mika, zee]) expect(p).toMatch(/Nothing is ever sent to anyone by you/);
  });
});
