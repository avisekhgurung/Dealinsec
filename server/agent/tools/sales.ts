/**
 * Sales tools: how good is this lead, learn about it from its own website, write a first message,
 * approve that message, and record that the person sent it.
 *
 * Each one wraps server/sales (the same code the /api/sales routes run), so the agent has exactly the
 * app's permissions and rules. What the tools add is the boundary the sales agent is built around:
 *   - the agent never sends anything. DealInSec has no way to send: the person sends an approved
 *     message from their own email app, and mark_outreach_sent only RECORDS that they did;
 *   - research always asks (it reads a website and spends the day's AI allowance);
 *   - approving a message is a CONSEQUENTIAL approval card that shows the exact text, bound to that
 *     text: if the text changes before the click, it fails instead of approving something unread;
 *   - the score and the next best action are computed by code; the agent reports them as given.
 */
import { z } from "zod";
import { dailyLimit } from "@shared/llm-cost";
import { leadStatusLabels, type LeadStatus } from "@shared/leads";
import { approveMessage, draftFacts, draftOutreach, listMessages, markSent, recipientFor, type MessageView } from "../../sales/outreach";
import { startResearch } from "../../sales/research";
import { salesTablesReady } from "../../sales/research-store";
import { getLead } from "../../services/leads";
import { assessLead } from "../../services/sales";
import { needsPermission, needsRead } from "../policy";
import type { AgentTool, ToolContext, ToolOutcome } from "../types";
import { fail } from "./shared";

const canWrite = needsPermission("deals.create", "changing leads");
const readLeads = needsRead("deals");
const who = (ctx: ToolContext) => ctx.user as any;
const route = (id: number) => `/leads/${id}`;
const failFrom = (r: { code: string; message: string }): Extract<ToolOutcome, { ok: false }> => fail(r.code, r.message);
const leadInput = z.object({ leadId: z.number().describe("Lead id") });
type LeadInput = z.infer<typeof leadInput>;

/** The message waiting on this lead (a draft or an approved one), if any, and the last one sent. */
async function messagesOf(ctx: ToolContext, leadId: number) {
  const r = await listMessages(who(ctx), leadId);
  if (!r.ok) return r;
  return { ok: true as const, current: r.messages.find((m) => m.status === "draft" || m.status === "approved") ?? null, lastSent: r.messages.find((m) => m.status === "sent") ?? null };
}
const show = (m: MessageView) => `To: ${m.to}\nSubject: ${m.subject}\n\n${m.body}`;

// ── reads ──────────────────────────────────────────────────────────────────

const scoreTool: AgentTool<LeadInput> = {
  name: "get_lead_score",
  description: "How good a lead looks and what to do next. Returns the score out of 100 with the reason for every part, the points that are unknown (an unknown part earns nothing and is not a bad mark), what is missing, the fit verdict and the NEXT BEST ACTION with its reason. All of it is computed by rules from what is recorded: report it as given, never produce a score or a verdict of your own.",
  risk: "READ_ONLY", activity: "searching", input: leadInput,
  authorize: readLeads,
  async run(ctx, { leadId }): Promise<ToolOutcome> {
    const r = await assessLead(who(ctx), leadId);
    if (!r.ok) return failFrom(r);
    const s = r.score;
    const parts = s.components.map((c) => `- ${c.label}: ${c.points === null ? "unknown" : `${c.points}/${c.max}`} — ${c.reason}`);
    return {
      ok: true, route: route(leadId),
      summary: [
        `Lead score: ${s.total}/100 (${s.unknownPoints} of 100 points are unknown, so the score is ${s.confidence === "low" ? "mostly a gap in what is known" : s.confidence === "medium" ? "partly measured" : "well measured"}).`,
        ...parts,
        s.missing.length ? `Missing: ${s.missing.join("; ")}.` : "Nothing important is missing.",
        r.fit ? `Fit with the ideal client: ${r.fit.verdict}.` : "",
        `Researched from its own website: ${r.researched ? "yes" : "no"}.`,
        `Next best action: ${r.next.label} — ${r.next.reason}`,
      ].filter(Boolean).join("\n"),
    };
  },
};

const getDraftTool: AgentTool<LeadInput> = {
  name: "get_outreach_draft",
  description: "The first message waiting on a lead: its status (draft, or approved and waiting to be sent), who it is addressed to and the full text. Or the date the message was sent, or that there is none. Use it when the user asks to see, read out or check the message.",
  risk: "READ_ONLY", activity: "searching", input: leadInput,
  authorize: readLeads,
  async run(ctx, { leadId }): Promise<ToolOutcome> {
    const r = await messagesOf(ctx, leadId);
    if (!r.ok) return failFrom(r);
    if (r.current) {
      const m = r.current;
      return { ok: true, route: route(leadId), summary: `A message is ${m.status === "draft" ? "drafted and NOT yet approved" : "approved and NOT yet sent (the user sends it from their own email app)"}${m.edited ? ", edited by the user" : ""}.\n\n${show(m)}` };
    }
    if (r.lastSent) return { ok: true, route: route(leadId), summary: `The first message was sent on ${r.lastSent.sentAt?.slice(0, 10)}. There is no message waiting.` };
    return { ok: true, route: route(leadId), summary: "There is no message for this lead yet. draft_outreach writes one." };
  },
};

// ── research ───────────────────────────────────────────────────────────────

const researchTool: AgentTool<LeadInput> = {
  name: "research_lead",
  description: "Read the lead's OWN website (its home page and up to two more pages on the same site) and record what it says as facts, each with the exact words from the page as evidence. Use it before scoring or writing to a company the user knows little about. It always asks first, runs in the background for up to about a minute, and writes nothing about the company that the page doesn't say. Needs the lead's website.",
  risk: "SAFE_MUTATION", input: leadInput,
  authorize: canWrite,
  async prepare(ctx, { leadId }) {
    const got = await getLead(who(ctx), leadId);
    if (!got.ok) return { ok: false, code: got.code, message: got.message };
    const lead = got.detail.lead;
    if (lead.archivedAt || lead.status === "won" || lead.status === "lost") return { ok: false, code: "closed", message: "That lead is closed, so there is nothing to research." };
    if (!lead.website) return { ok: false, code: "no_website", message: "This lead has no website recorded. Research reads the company's own website; ask the user for it and add it with update_lead." };
    try { if (!(await salesTablesReady())) return { ok: false, code: "SALES_NOT_SETUP", message: "The sales agent isn't set up on this server yet." }; } catch { return { ok: false, code: "SALES_NOT_SETUP", message: "The sales agent isn't available right now." }; }
    return {
      ok: true, args: { leadId }, forceApproval: true,
      preview: {
        title: `Research ${lead.companyName}`,
        lines: [{ label: "Website", value: lead.website }],
        effects: [
          "DealInSec reads the home page and up to two other pages on that company's own website.",
          "One AI call turns them into findings. Only findings whose exact words are on the page are kept, as facts with that evidence; the rest are dropped.",
          `Counts towards today's research allowance (${dailyLimit("research")} a day).`,
          "Nothing is sent to the company.",
        ],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const leadId = Number(args.leadId);
    const r = await startResearch(who(ctx), leadId, { by: "agent" });
    if (!r.ok) return failFrom(r);
    return { ok: true, route: route(leadId), summary: "Research has started and runs in the background (up to about a minute). Tell the user it has started, not that it is finished. When they ask for the result, call get_lead_score or get_lead: the facts found, with their evidence, are recorded on the lead." };
  },
};

// ── outreach ───────────────────────────────────────────────────────────────

const draftTool: AgentTool<LeadInput> = {
  name: "draft_outreach",
  description: "Write a FIRST message to a lead (one short email) from the facts recorded and verified about its company, the user's own offer and their notes. It is saved as a DRAFT on the lead for the user to read, edit and approve. NOTHING is sent and nothing is approved. It refuses when the lead has no email address on record or no verified facts yet (research it first), when the lead is marked do-not-contact, or when a first message was already sent. Never invent an address or a fact to get around a refusal.",
  risk: "SAFE_MUTATION", input: leadInput,
  authorize: canWrite,
  async prepare(ctx, { leadId }) {
    const got = await getLead(who(ctx), leadId);
    if (!got.ok) return { ok: false, code: got.code, message: got.message };
    const { lead, claims } = got.detail;
    if (lead.doNotContact) return { ok: false, code: "do_not_contact", message: "This lead is marked do-not-contact, so no message can be written for it." };
    if (lead.archivedAt || lead.status === "won" || lead.status === "lost") return { ok: false, code: "closed", message: "That lead is closed, so it can't take a message." };
    const sc = claims.map((c) => ({ id: c.id, field: c.field, value: c.value, status: c.status, evidenceUrl: c.evidenceUrl, createdAt: c.createdAt }));
    const to = recipientFor(lead, sc);
    if (!to) return { ok: false, code: "no_address", message: "There is no email address for this lead. Never guess one: ask the user for it, or research the lead's website to find a business address." };
    if (!draftFacts(sc).facts.length) return { ok: false, code: "no_facts", message: "Nothing verified is recorded about this company yet, so a message would have nothing true to say. Research the lead first (research_lead)." };
    return {
      ok: true, args: { leadId },
      preview: {
        title: `Write a first message to ${lead.companyName}`,
        lines: [{ label: "To", value: to.address }],
        effects: ["One AI call writes it from the facts recorded about the company.", "It is saved as a draft for you to read, edit and approve. Nothing is sent."],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const leadId = Number(args.leadId);
    const r = await draftOutreach(who(ctx), leadId, { by: "agent" });
    if (!r.ok) return failFrom(r);
    return {
      ok: true, route: route(leadId),
      summary: `Drafted a message${r.retried ? " (the first attempt didn't pass the safety checks and was rewritten)" : ""}. It is a DRAFT: nothing was sent and it is not approved. The user can read and edit it on the lead page.\n\n${show(r.message)}\n\nTo approve exactly this text, call approve_outreach when the user says to.`,
    };
  },
};

const approveTool: AgentTool<LeadInput> = {
  name: "approve_outreach",
  description: "Approve the draft message waiting on a lead, exactly as written. Call it only when the user says to approve that draft (read it out first if they haven't seen it). It always asks, shows the full text, and is bound to that text: if the text changes before the click, it fails. Approving does NOT send anything: DealInSec cannot send; the user opens it in their own email app and sends it.",
  risk: "CONSEQUENTIAL_MUTATION", input: leadInput,
  authorize: canWrite,
  async prepare(ctx, { leadId }) {
    const got = await getLead(who(ctx), leadId);
    if (!got.ok) return { ok: false, code: got.code, message: got.message };
    const lead = got.detail.lead;
    if (lead.doNotContact) return { ok: false, code: "do_not_contact", message: "This lead is marked do-not-contact, so no message can be approved for it." };
    const m = await messagesOf(ctx, leadId);
    if (!m.ok) return { ok: false, code: m.code, message: m.message };
    if (!m.current) return { ok: false, code: "no_draft", message: "There is no draft to approve. draft_outreach writes one." };
    if (m.current.status === "approved") return { ok: false, code: "already_approved", message: "That message is already approved. The user sends it from their own email app, then tells you (mark_outreach_sent)." };
    return {
      ok: true, args: { leadId, messageId: m.current.id, bodyHash: m.current.bodyHash },
      preview: {
        title: `Approve the message to ${lead.companyName}`,
        lines: [{ label: "To", value: m.current.to ?? "" }, { label: "Subject", value: m.current.subject }, { label: "Message", value: m.current.body }],
        effects: ["Marks exactly this text as approved. If it is changed afterwards, the approval is withdrawn.", "DealInSec does not send it. You open it in your email app, send it, then record that you sent it."],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await approveMessage(who(ctx), Number(args.messageId), args.bodyHash);
    if (!r.ok) return failFrom(r);
    return { ok: true, route: route(Number(args.leadId)), summary: `${r.already ? "That message was already approved." : "Approved."} It has NOT been sent: DealInSec cannot send. The user opens it in their own email app from the lead page and sends it, then tells you.` };
  },
};

const sentTool: AgentTool<LeadInput> = {
  name: "mark_outreach_sent",
  description: "Record that the user SENT the approved message from their own email app. Call it only when the USER tells you they sent it, never because a draft exists or looks ready. It marks the message sent, moves the lead to Contacted (through Qualified if needed) and adds a follow-up four days out. It does not send anything.",
  risk: "SAFE_MUTATION", input: leadInput,
  authorize: canWrite,
  async prepare(ctx, { leadId }) {
    const got = await getLead(who(ctx), leadId);
    if (!got.ok) return { ok: false, code: got.code, message: got.message };
    const m = await messagesOf(ctx, leadId);
    if (!m.ok) return { ok: false, code: m.code, message: m.message };
    if (!m.current) return { ok: false, code: m.lastSent ? "already_sent" : "no_message", message: m.lastSent ? "That message is already recorded as sent." : "There is no message for this lead." };
    if (m.current.status !== "approved") return { ok: false, code: "not_approved", message: "The message isn't approved yet. The user approves it first (approve_outreach, or on the lead page), then sends it." };
    const stage = (s: string) => leadStatusLabels[s as LeadStatus] ?? s;
    return {
      ok: true, args: { leadId, messageId: m.current.id },
      preview: {
        title: `Record that the message to ${got.detail.lead.companyName} was sent`,
        lines: [{ label: "To", value: m.current.to ?? "" }, { label: "Subject", value: m.current.subject }],
        effects: [`Moves the lead from ${stage(got.detail.lead.status)} to Contacted, and adds a follow-up in four days.`, "This only records that you sent it. DealInSec sends nothing."],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await markSent(who(ctx), Number(args.messageId));
    if (!r.ok) return failFrom(r);
    return { ok: true, route: route(Number(args.leadId)), summary: r.already ? "That message was already recorded as sent." : `Recorded as sent${r.movedTo ? `; the lead is now ${leadStatusLabels[r.movedTo as LeadStatus] ?? r.movedTo}` : ""}. A follow-up is set for four days from now.` };
  },
};

export const SALES_TOOLS: AgentTool<any>[] = [scoreTool, researchTool, draftTool, getDraftTool, approveTool, sentTool];
