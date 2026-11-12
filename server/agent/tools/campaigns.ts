/**
 * Read-only tools over saved client profiles and outreach campaigns, for the AI team. Each answers from the same
 * service the pages use, as the signed-in person, so a coworker can only report what that person could open.
 *
 * What they return is deliberately thin: names, counts, stages and reasons. No message text and nothing from an
 * email ever passes through these tools — a coworker that needs a draft's words reads it through get_outreach_draft,
 * which has its own rules.
 */
import { z } from "zod";
import { countryLabel } from "@shared/icp";
import { SIGNAL_LABEL } from "@shared/prospect";
import { REQUIREMENT_LABEL } from "@shared/profile-keys";
import { needsRead } from "../policy";
import type { AgentTool, ToolContext, ToolOutcome } from "../types";
import { fail } from "./shared";

const who = (ctx: ToolContext) => ctx.user as any;
const CAMPAIGNS = "/outbound?view=campaigns";
const pct = (v: number | null) => (v === null ? "no rate yet" : `${v}%`);

const listClientProfilesTool: AgentTool<Record<string, never>> = {
  name: "list_client_profiles",
  description: "The person's saved client profiles: who they want as clients, each with an id, its kinds of company, places, size, the services they sell to them, the buying signals they care about and what a company must have. Use it when they mention a profile, or before starting a search for a kind of client they have already described. To search from one, pass its id as profileId (and one of its kinds of company as kind) when starting the research task: the search is then built from the profile exactly.",
  risk: "READ_ONLY", activity: "searching",
  input: z.object({}),
  authorize: needsRead("deals"),
  async run(ctx): Promise<ToolOutcome> {
    const { listProfiles } = await import("../../profiles/service");
    const r = await listProfiles(who(ctx));
    if (!r.ok) return fail(r.code, r.message);
    if (!r.profiles.length) return { ok: true, route: "/outbound", summary: "The person has no saved client profiles yet. They can create one in Client Radar (Manage profiles), or just describe who they are looking for." };
    const line = (p: (typeof r.profiles)[number]) => {
      const size = p.employeeMin && p.employeeMax ? `${p.employeeMin}–${p.employeeMax} people` : p.employeeMax ? `up to ${p.employeeMax} people` : p.employeeMin ? `${p.employeeMin}+ people` : "any size";
      return [
        `- id ${p.id}: "${p.name}"${p.isDefault ? " (default)" : ""}`,
        `  kinds of company: ${p.industries.join("; ")}`,
        `  where: ${[...p.countries.map(countryLabel), ...p.locations].join(", ") || "worldwide"} · ${size}`,
        `  sells them: ${p.services.join(", ") || "not set"}`,
        p.signals.length ? `  buying signals wanted: ${p.signals.map((s) => SIGNAL_LABEL[s]).join(", ")}` : null,
        p.requirements.length ? `  a company must have: ${p.requirements.map((k) => REQUIREMENT_LABEL[k].toLowerCase()).join(", ")}` : null,
      ].filter(Boolean).join("\n");
    };
    return { ok: true, route: "/outbound", summary: `${r.profiles.length} saved client profile${r.profiles.length === 1 ? "" : "s"}:\n${r.profiles.map(line).join("\n")}` };
  },
};

const listCampaignsTool: AgentTool<Record<string, never>> = {
  name: "list_campaigns",
  description: "The person's outreach campaigns (groups of leads written to together), each with an id and its real numbers: leads, drafts waiting to be read, approved, sent, replies, bounces, and why drafting or sending stopped if it did. Use it for any question about how outreach campaigns are doing or what needs doing in them. Report the numbers as given; a rate is unknown until something was sent.",
  risk: "READ_ONLY", activity: "searching",
  input: z.object({}),
  authorize: needsRead("deals"),
  async run(ctx): Promise<ToolOutcome> {
    const { listCampaigns } = await import("../../campaigns/service");
    const r = await listCampaigns(who(ctx));
    if (!r.ok) return fail(r.code, r.message);
    const open = r.campaigns.filter((c) => c.status === "active");
    if (!open.length) return { ok: true, route: CAMPAIGNS, summary: `The person has no open campaigns${r.campaigns.length ? ` (${r.campaigns.length} archived)` : ""}. A campaign is made from leads they already have, in Client Radar → Campaigns.` };
    const line = (c: (typeof open)[number]) => {
      const n = c.counts;
      return [
        `- id ${c.id}: "${c.name}"${c.profileName ? ` (for profile "${c.profileName}")` : ""}`,
        `  ${n.members} leads · ${n.queued} waiting for a draft · ${n.draft} drafts to review · ${n.approved} approved, not sent · ${n.sent} sent · ${n.skipped + n.failed} set aside`,
        n.sent ? `  came back: ${n.replied} replied (${pct(c.rates.reply)}), ${n.interested} read as interested, ${n.bounced} bounced (${pct(c.rates.bounce)}), ${n.optedOut} asked to stop` : "  nothing sent yet",
        c.preparing ? "  drafts are being written now" : c.prepareStopLabel && c.prepareStop !== "stopped" ? `  drafting stopped: ${c.prepareStopLabel}` : null,
      ].filter(Boolean).join("\n");
    };
    return { ok: true, route: CAMPAIGNS, summary: `${open.length} open campaign${open.length === 1 ? "" : "s"} (approved messages are sent by the person, one at a time; DealInSec never sends a campaign by itself):\n${open.map(line).join("\n")}` };
  },
};

const getCampaignTool: AgentTool<{ campaignId: number }> = {
  name: "get_campaign",
  description: "One outreach campaign, lead by lead: where each lead stands (waiting for a draft, draft to review, approved, sent, skipped) and the reason when it was skipped or held back, plus who replied or bounced. Use it to say what needs the person in a campaign. It never returns a message's text.",
  risk: "READ_ONLY", activity: "searching",
  input: z.object({ campaignId: z.number().int().positive().describe("The id from list_campaigns") }).strict(),
  authorize: needsRead("deals"),
  async run(ctx, { campaignId }): Promise<ToolOutcome> {
    const { getCampaign } = await import("../../campaigns/service");
    const r = await getCampaign(who(ctx), campaignId, {}, { readOnly: true });
    if (!r.ok) return fail(r.code, r.message);
    const route = `${CAMPAIGNS}&campaign=${r.campaign.id}`;
    const shown = r.members.slice(0, 60);
    const rows = shown.map((m) => `- ${m.companyName} (lead ${m.leadId}): ${m.stageLabel}${m.note ? ` — ${m.note}` : ""}${m.interested ? " · read as interested" : ""}${m.outcomes.length ? ` · ${m.outcomes.join(", ").replace(/_/g, " ")}` : ""}`);
    const n = r.campaign.counts;
    return {
      ok: true, route,
      summary: [`Campaign "${r.campaign.name}": ${n.members} leads · ${n.draft} drafts to review · ${n.approved} approved · ${n.sent} sent · ${n.replied} replied · ${n.bounced} bounced.`, ...rows, r.members.length > shown.length ? `(${r.members.length - shown.length} more leads not listed)` : null].filter(Boolean).join("\n"),
    };
  },
};

export const CAMPAIGN_TOOLS: AgentTool<any>[] = [listClientProfilesTool, listCampaignsTool, getCampaignTool];
