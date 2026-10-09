/**
 * AI Outbound tools: describe who to reach, run a prospect search, read a run, read what is known about one company,
 * research it, look for its people, choose an outreach angle, and add it to Leads.
 *
 * Each wraps server/outbound/service.ts (the code the /api/outbound routes run), so the agent has the app's exact
 * permissions and rules. Page text, search results and provider data reach the model only inside the loop's
 * <untrusted> fence, and nothing a website says can call a tool or change a lead: every tool that spends allowance
 * or writes data always asks first.
 *
 *   parse_icp, get_discovery_run, get_prospect_intelligence      reads
 *   discover_prospects, research_prospect, find_decision_maker   always ask (they spend the day's allowance)
 *   get_outreach_angle                                           writes a suggestion onto the prospect; runs unasked at level 1
 *   add_prospect_to_leads                                        creates a lead: asks like create_lead
 */
import { z } from "zod";
import { dailyLimit } from "@shared/llm-cost";
import { icpSchema } from "@shared/icp";
import { runBudget } from "@shared/prospect";
import { addToLeads, findContacts, generateAngle, getProspect, getRun, listRuns, parseIcp, researchProspect, searchAvailable, startRun, type ProspectBrief, type RunView } from "../../outbound/service";
import { dailyRunLimit } from "../../outbound/limits";
import { needsPermission, needsRead } from "../policy";
import type { AgentTool, ToolContext, ToolOutcome } from "../types";
import { fail, safeName } from "./shared";

const canWrite = needsPermission("deals.create", "changing leads");
const readLeads = needsRead("deals");
const who = (ctx: ToolContext) => ctx.user as any;
const failFrom = (r: { code: string; message: string }): Extract<ToolOutcome, { ok: false }> => fail(r.code, r.message);
const link = "/outbound";

const requestInput = z.object({ request: z.string().min(3).max(500).describe("Who the user wants to reach, in their words: the kind of company, the place, the size, who they serve, how many") });
const runInput = z.object({ runId: z.string().min(3).max(40).describe("The search id returned by discover_prospects or get_discovery_run") });
const prospectInput = z.object({ prospectId: z.number().int().positive().describe("Prospect id, as listed by get_discovery_run"), runId: z.string().min(3).max(40).describe("The search it came from") });

const money = (u: number) => `$${u.toFixed(2)}`;
function runLine(r: RunView): string {
  const c = r.counters;
  return `${r.status}${r.status === "running" ? ` (${r.stage})` : ""}: ${c.discovered ?? 0} discovered, ${c.verified ?? 0} verified, ${c.icpMatch ?? 0} match the ICP, ${c.signals ?? 0} with a recent reason to reach out, ${c.decisionMakers ?? 0} with a named person, ${c.ready ?? 0} outreach-ready. Cost so far ${money(r.costUsd)}.`;
}
const prospectLine = (p: import("../../outbound/service").ProspectCard) =>
  `- [${p.id}] ${p.name} (${p.domain}) ${p.score ? `${p.score.total}/100` : "not scored"}${p.ready ? " READY" : ""}${p.whyNow ? ` — why now: ${p.whyNow.label}, ${p.whyNow.freshness}: ${p.whyNow.value}` : ""}${p.decisionMaker ? ` — person: ${p.decisionMaker.value}` : ""}`;
function briefText(b: ProspectBrief): string {
  const p = b.prospect;
  const lines = [
    `${p.name} (${p.domain}) — prospect ${p.id}${p.leadId ? `, already lead ${p.leadId}` : ""}${p.ready ? ", OUTREACH-READY" : ""}`,
    p.score ? `Score ${p.score.total}/100 (${p.score.unknownPoints} of 100 points unknown, confidence ${p.score.confidence}). ${p.score.components.map((c) => `${c.label} ${c.points === null ? "unknown" : `${c.points}/${c.max}`}`).join(", ")}.` : "Not scored yet (not researched).",
    p.fit ? `Fit: ${p.fit.verdict} — ${p.fit.headline}` : "",
    b.facts.length ? `FACTS (stated on their site):\n${b.facts.map((e) => `- ${e.label}: ${e.value} [F${e.id}]`).join("\n")}` : "No confirmed facts yet.",
    b.signals.length ? `SIGNALS (why now; stated on their site):\n${b.signals.map((e) => `- ${e.label}${e.freshness ? `, ${e.freshness}` : ""}: ${e.value} [F${e.id}]`).join("\n")}` : "No signals found.",
    b.people.length ? `PEOPLE:\n${b.people.map((e) => `- ${e.value}${e.meta?.email ? `, ${e.meta.email} (${e.meta.emailStatus})` : ""}${e.source === "provider" ? " [from data provider]" : ""} [F${e.id}]`).join("\n")}` : "No named decision maker yet.",
    b.inferences.length || b.opportunities.length ? `INFERENCES (guesses, never state as fact):\n${[...b.inferences, ...b.opportunities].map((e) => `- ${e.label}: ${e.value} [F${e.id}]`).join("\n")}` : "",
    b.angle ? `OUTREACH ANGLE (${b.angle.confidence} confidence): problem — ${b.angle.problem}; opportunity — ${b.angle.opportunity}; positioning — ${b.angle.positioning}${b.angle.targetPerson ? `; write to ${b.angle.targetPerson}` : ""}.` : "",
    p.score?.missing.length ? `Not known: ${p.score.missing.join("; ")}.` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

const parseIcpTool: AgentTool<z.infer<typeof requestInput>> = {
  name: "parse_icp",
  description: "Turn the user's description of who they want to reach into a structured profile (kind of company, countries, size, who they serve, roles to contact, quantity) and show the searches that would run. Nothing is searched or saved. Use it before discover_prospects when the request is unclear, or when the user asks what you understood.",
  risk: "READ_ONLY", activity: "searching", input: requestInput,
  authorize: canWrite,
  async run(ctx, { request }): Promise<ToolOutcome> {
    const r = await parseIcp(who(ctx), request);
    if (!r.ok) return failFrom(r);
    return { ok: true, route: link, summary: `Understood as: ${r.description}. Roles to contact: ${r.icp.roles.join(", ") || "decision makers"}. Quantity ${r.icp.quantity}. Planned searches:\n${r.searches.map((q) => `- ${q}`).join("\n")}\nNothing has been searched yet.` };
  },
};

const discoverTool: AgentTool<z.infer<typeof requestInput>> = {
  name: "discover_prospects",
  description: "Start a prospect search: find real companies matching the description, check each one's website, read what it says, look for recent reasons to reach out, find named decision makers, and score each with the lead score. It runs in the background for a minute or two and writes NO leads: the user (or add_prospect_to_leads) adds the good ones. Always asks first, because it spends the workspace's daily search and AI allowance. Say it has STARTED, never that it is finished; read the result later with get_discovery_run.",
  risk: "SAFE_MUTATION", input: requestInput,
  authorize: canWrite,
  async prepare(ctx, { request }) {
    // No search connected: say so before a model call is spent on the profile, and never put up a card for a search that can't run.
    if (!(await searchAvailable())) return { ok: false, code: "DISCOVERY_NOT_SETUP", message: "Web search isn't set up on this server yet, so I can't search for companies. Tell the user plainly; do not offer a prospect search." };
    const p = await parseIcp(who(ctx), request);
    if (!p.ok) return { ok: false, code: p.code, message: p.message };
    const b = runBudget(p.icp.quantity);
    return {
      ok: true, args: { request, icp: p.icp, searches: p.searches }, forceApproval: true,
      preview: {
        title: `Find ${p.icp.quantity} prospects`,
        lines: [{ label: "Looking for", value: p.description }, { label: "Reaching", value: p.icp.roles.slice(0, 4).join(", ") || "decision makers" }, { label: "Searches", value: `${p.searches.length} web searches` }],
        effects: [
          `Searches the web, then reads up to ${b.verify} company websites (public pages only) and uses the AI on up to ${b.enrich + b.research} of them.`,
          `Counts towards today's allowance: ${dailyRunLimit()} searches a day, ${dailyLimit("enrich")} reading calls, ${dailyLimit("signals")} research calls.`,
          "Nothing is sent to any company and no lead is created until you add one.",
        ],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const parsed = icpSchema.safeParse(args.icp);
    if (!parsed.success) return fail("invalid", "That search profile isn't valid.");
    const r = await startRun(who(ctx), { request: args.request, icp: parsed.data, searches: args.searches }, { by: "agent" });
    if (!r.ok) return failFrom(r);
    return { ok: true, route: link, summary: `${r.existing ? "That search was already running." : "The search has started."} Run id: ${r.run.id}. It takes a minute or two. Tell the user it has STARTED, not finished, and read it later with get_discovery_run.` };
  },
};

const getRunTool: AgentTool<{ runId?: string }> = {
  name: "get_discovery_run",
  description: "Where a prospect search stands and who it found: the funnel (discovered, verified, ICP matches, with a reason to reach out now, with a person, outreach-ready), the cost, and the best prospects with their score and why now. Without a runId, lists recent searches.",
  risk: "READ_ONLY", activity: "searching", input: z.object({ runId: z.string().min(3).max(40).optional() }),
  authorize: readLeads,
  async run(ctx, { runId }): Promise<ToolOutcome> {
    if (!runId) {
      const r = await listRuns(who(ctx));
      if (!r.ok) return failFrom(r);
      if (!r.runs.length) return { ok: true, route: link, summary: "No prospect searches yet. discover_prospects starts one." };
      // The newest search's companies come with the list, so a company named by the user can be found in one step.
      const latest = await getRun(who(ctx), r.runs[0].id);
      const top = latest.ok ? latest.prospects.filter((p) => !p.rejectReason).slice(0, 10) : [];
      return {
        ok: true, route: link,
        summary: `Recent searches (newest first; pass a runId to see one's prospects):\n${r.runs.slice(0, 8).map((x) => `- ${x.id}: ${x.description} — ${runLine(x)}`).join("\n")}${top.length ? `\n\nProspects of the newest search (${r.runs[0].id}):\n${top.map(prospectLine).join("\n")}` : ""}`,
      };
    }
    const r = await getRun(who(ctx), runId);
    if (!r.ok) return failFrom(r);
    const top = r.prospects.filter((p) => !p.rejectReason).slice(0, 10);
    const aside = r.prospects.length - top.length;
    return {
      ok: true, route: link,
      summary: [
        `${r.run.description} — ${runLine(r.run)}`,
        r.run.errorCode ? `Stopped because: ${r.run.errorCode}.` : "",
        top.length ? `Prospects (best first):\n${top.map(prospectLine).join("\n")}` : r.run.status === "running" ? "No companies are ready to show yet." : "No company passed the checks.",
        aside > 0 ? `${aside} others were set aside (not a business site, not a fit, or couldn't be checked).` : "",
      ].filter(Boolean).join("\n"),
    };
  },
};

const intelTool: AgentTool<{ prospectId: number }> = {
  name: "get_prospect_intelligence",
  description: "Everything known about ONE prospect, kept apart: FACTS and SIGNALS (stated on their website, each with its evidence), PEOPLE, and INFERENCES and OPPORTUNITIES (guesses, never to be stated as fact), plus the score and its parts, what is not known, and the outreach angle if one exists. Use it for \"tell me about this company\", \"why now\", \"who should I contact\", \"what is the score\". Report the score as given; never produce your own.",
  risk: "READ_ONLY", activity: "searching", input: z.object({ prospectId: z.number().int().positive() }),
  authorize: readLeads,
  async run(ctx, { prospectId }): Promise<ToolOutcome> {
    const r = await getProspect(who(ctx), prospectId);
    if (!r.ok) return failFrom(r);
    return { ok: true, route: link, summary: briefText(r.brief) };
  },
};

const researchTool: AgentTool<z.infer<typeof prospectInput>> = {
  name: "research_prospect",
  description: "Read this prospect's own website again (careers, news, team, case studies) for dated reasons to reach out and named people, ignoring the saved copy. Always asks first (it spends the day's AI allowance). Report only what get_prospect_intelligence shows afterwards.",
  risk: "SAFE_MUTATION", input: prospectInput,
  authorize: canWrite,
  async prepare(ctx, { prospectId, runId }) {
    const r = await getProspect(who(ctx), prospectId);
    if (!r.ok) return { ok: false, code: r.code, message: r.message };
    return {
      ok: true, args: { prospectId, runId }, forceApproval: true,
      preview: { title: `Research ${r.brief.prospect.name} again`, lines: [{ label: "Website", value: r.brief.prospect.website }], effects: ["Reads up to 5 public pages on that company's own website and uses the AI once.", "Only findings whose exact words are on the page are kept.", `Counts towards today's research allowance (${dailyLimit("signals")} a day).`, "Nothing is sent to the company."] },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await researchProspect(who(ctx), Number(args.prospectId), args.runId);
    if (!r.ok) return failFrom(r);
    return { ok: true, route: link, summary: `Researched again.\n${briefText(r.brief)}` };
  },
};

const contactsTool: AgentTool<z.infer<typeof prospectInput>> = {
  name: "find_decision_maker",
  description: "Look up named people at this company with the connected contact data provider (business emails with the provider's own verification status). Only available when a provider is connected; people named on the company's own website are already in get_prospect_intelligence. Always asks first (a paid lookup). Never guess an email.",
  risk: "SAFE_MUTATION", input: prospectInput,
  authorize: canWrite,
  async prepare(ctx, { prospectId, runId }) {
    const r = await getProspect(who(ctx), prospectId);
    if (!r.ok) return { ok: false, code: r.code, message: r.message };
    if (!r.brief.providers.contact) return { ok: false, code: "CONTACTS_NOT_SETUP", message: "No contact data provider is connected. The people named on the company's own website are in get_prospect_intelligence; never guess an email address." };
    return { ok: true, args: { prospectId, runId }, forceApproval: true, preview: { title: `Find people at ${r.brief.prospect.name}`, lines: [{ label: "Company", value: r.brief.prospect.domain }], effects: ["Asks the connected data provider for named people and their business emails (a paid lookup).", "Each person is saved as a suggestion, with the provider's own verification status.", "An email is added to a lead only if you pick that person and the provider verified it."] } };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await findContacts(who(ctx), Number(args.prospectId), args.runId);
    if (!r.ok) return failFrom(r);
    return { ok: true, route: link, summary: `Found ${r.found} ${r.found === 1 ? "person" : "people"}.\n${briefText(r.brief)}` };
  },
};

const angleTool: AgentTool<{ prospectId: number }> = {
  name: "get_outreach_angle",
  description: "Choose the angle for a first message to this prospect (problem, opportunity, positioning, who to write to), built only from the findings stored for it, each cited. Returns the saved angle, or writes a new one. It is a suggestion: nothing is sent. Refuses when there is no reason to reach out yet (research first). After the prospect is added to Leads, draft_outreach uses this angle.",
  risk: "SAFE_MUTATION", input: z.object({ prospectId: z.number().int().positive() }),
  authorize: canWrite,
  async prepare(ctx, { prospectId }) {
    const r = await getProspect(who(ctx), prospectId);
    if (!r.ok) return { ok: false, code: r.code, message: r.message };
    return { ok: true, args: { prospectId }, forceApproval: true, preview: { title: `Choose an outreach angle for ${r.brief.prospect.name}`, lines: [], effects: ["Uses the AI once, on the findings already stored for this company.", "Saved as a suggestion. Nothing is sent."] } };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await generateAngle(who(ctx), Number(args.prospectId));
    if (!r.ok) return failFrom(r);
    return { ok: true, route: link, summary: briefText(r.brief) };
  },
};

const addTool: AgentTool<{ prospectId: number; contactFindingId?: number }> = {
  name: "add_prospect_to_leads",
  description: "Add a prospect to the user's Leads, with its evidence copied to the lead's facts. Do it only when the user asks to add that company. The lead's contact email is set only if the user names a person from get_prospect_intelligence AND the provider verified that email; never put an email you were not given.",
  risk: "SAFE_MUTATION", input: z.object({ prospectId: z.number().int().positive(), contactFindingId: z.number().int().positive().optional().describe("The [F id] of the person to use as the contact, only if the user chose one") }),
  authorize: canWrite,
  async prepare(ctx, { prospectId, contactFindingId }) {
    const r = await getProspect(who(ctx), prospectId);
    if (!r.ok) return { ok: false, code: r.code, message: r.message };
    const p = r.brief.prospect;
    if (p.leadId) return { ok: false, code: "already_lead", message: `${safeName(p.name)} is already lead ${p.leadId}.` };
    if (p.rejectReason) return { ok: false, code: "rejected", message: `${safeName(p.name)} was set aside (${p.rejectLabel}).` };
    return { ok: true, args: { prospectId, ...(contactFindingId ? { contactFindingId } : {}) }, preview: { title: `Add lead: ${p.name}`, lines: [{ label: "Website", value: p.domain }, ...(p.score ? [{ label: "Score", value: `${p.score.total} / 100` }] : []), ...(p.decisionMaker ? [{ label: "Contact", value: p.decisionMaker.value }] : [])], effects: ["Adds it to your pipeline as a New lead, with what was found as its facts.", "Nothing is sent to the company."] } };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await addToLeads(who(ctx), Number(args.prospectId), { contactFindingId: args.contactFindingId });
    if (!r.ok) return failFrom(r);
    return { ok: true, route: `/leads/${r.leadId}`, summary: r.existing ? `It was already in the pipeline as lead ${r.leadId}.` : `Added it as lead ${r.leadId}, with its evidence as facts.` };
  },
};

export const OUTBOUND_TOOLS: AgentTool<any>[] = [parseIcpTool, discoverTool, getRunTool, intelTool, researchTool, contactsTool, angleTool, addTool];
