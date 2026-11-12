/**
 * The Outreach Studio's own server pieces (12 Nov 2026). Everything a message needs still goes through the existing
 * email outreach (server/sales/outreach.ts) and channels (server/channels/service.ts); this adds only what the Studio
 * shows around them:
 *   - what the person did with a message outside DealInSec: copied it, opened the platform (never a send)
 *   - follow-up reminders on any channel, planned and completed, as the lead's own follow-up tickets
 *   - what a reply said, as the person recorded it (interested, not now, a meeting...)
 *   - the lead's research for the left panel, ranked the way drafts use it (shared/draft-evidence.ts)
 *   - honest overview numbers: what DealInSec saw happen versus what the person recorded
 *   - the company's own social profiles and WhatsApp link, read once from its website (plain rules, no model)
 * Workspace isolation: every read and write is filtered by the caller's organization; another workspace's lead
 * answers "not found", like the rest of the leads module.
 */
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { CHANNELS, CHANNEL_LABEL, type Channel } from "@shared/channels";
import { buildDraftEvidence, type DraftEvidence, type EvidenceFinding } from "@shared/draft-evidence";
import { SOCIAL_FIELDS, SOCIAL_KINDS, socialLinksFrom, type SocialLinks } from "@shared/social-links";
import { addClaim, closeTicket, createTicket, getLead, readGate, writeGate } from "../services/leads";
import { leadsStore } from "../leads/store";
import type { Result, Who } from "../services/leads";

const fail = (status: number, code: string, message: string) => ({ ok: false as const, status, code, message });
const channelOf = (v: unknown): Channel | null => (typeof v === "string" && (CHANNELS as readonly string[]).includes(v) ? (v as Channel) : null);
const DAY = 86_400_000;

/* ── hand-off: copied, opened ───────────────────────────────────────────── */

const handoffSchema = z.object({ channel: z.string(), action: z.enum(["copied", "opened"]), messageId: z.number().int().positive().optional() }).strict();

/**
 * Records that the person copied a message or opened the platform to send it. It is never a send: the message keeps its
 * state until they say they sent it. Written "quietly", so it doesn't move the lead to the top of the Leads list.
 */
export async function recordHandoff(user: Who, leadId: number, raw: unknown): Promise<Result<{ recorded: true }>> {
  const p = handoffSchema.safeParse(raw ?? {});
  const channel = p.success ? channelOf(p.data.channel) : null;
  if (!p.success || !channel) return fail(400, "invalid", "Say which channel, and whether you copied it or opened it.");
  const gate = writeGate(user);
  if (gate) return gate;
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  await leadsStore.addEvent(user.organizationId!, leadId, {
    kind: p.data.action === "copied" ? "outreach_copied" : "outreach_opened",
    data: { channel, ...(p.data.messageId ? { messageId: p.data.messageId } : {}) }, actor: "user", actorUserId: user.id, quiet: true,
  });
  return { ok: true, recorded: true };
}

/* ── follow-ups on any channel ──────────────────────────────────────────── */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const followUpSchema = z.object({ channel: z.string(), dueOn: z.string().regex(DATE), note: z.string().max(200).optional() }).strict();

/**
 * A reminder to follow up with this lead on a channel, due on a day. It is the lead's own follow-up ticket (so it shows
 * on the lead page and in Home's follow-ups) at noon UTC, so the day never shifts in India. Nothing is sent by it.
 */
export async function scheduleFollowUp(user: Who, leadId: number, raw: unknown, now = new Date()): Promise<Result<{ ticketId: number; dueOn: string }>> {
  const p = followUpSchema.safeParse(raw ?? {});
  const channel = p.success ? channelOf(p.data.channel) : null;
  if (!p.success || !channel) return fail(400, "invalid", "Pick a channel and a day for the follow-up.");
  const due = new Date(`${p.data.dueOn}T12:00:00.000Z`);
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(due.getTime()) || due.getTime() < today.getTime()) return fail(400, "invalid", "Pick today or a later day.");
  if (due.getTime() - today.getTime() > 366 * DAY) return fail(400, "invalid", "Pick a day within the next year.");
  const note = p.data.note?.trim();
  const t = await createTicket(user, leadId, { title: `Follow up on ${CHANNEL_LABEL[channel]}${note ? `: ${note}` : ""}`.slice(0, 200), kind: "follow_up", dueAt: due.toISOString() });
  if (!t.ok) return t;
  await leadsStore.addEvent(user.organizationId!, leadId, { kind: "followup_scheduled", data: { channel, dueOn: p.data.dueOn, ticketId: t.ticket.id }, actor: "user", actorUserId: user.id });
  return { ok: true, ticketId: t.ticket.id, dueOn: p.data.dueOn };
}

/** Marks a follow-up reminder done, and says so on the lead's timeline. */
export async function completeFollowUp(user: Who, leadId: number, ticketId: number): Promise<Result<{ done: true }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  const ticket = got.detail.tickets.find((t) => t.id === ticketId);
  if (!ticket || ticket.kind !== "follow_up") return fail(404, "not_found", "That follow-up isn't on this lead.");
  const c = await closeTicket(user, leadId, ticketId, "done");
  if (!c.ok) return c;
  const channel = /^Follow up on (\w+)/.exec(ticket.title)?.[1]?.toLowerCase();
  await leadsStore.addEvent(user.organizationId!, leadId, { kind: "followup_done", data: { ticketId, ...(channelOf(channel) ? { channel } : {}) }, actor: "user", actorUserId: user.id });
  return { ok: true, done: true };
}

/* ── what a reply said ──────────────────────────────────────────────────── */

export const REPLY_OUTCOMES = ["interested", "question", "meeting", "not_now", "not_interested", "other"] as const;
export type ReplyOutcome = (typeof REPLY_OUTCOMES)[number];
export const REPLY_OUTCOME_LABEL: Record<ReplyOutcome, string> = {
  interested: "Interested", question: "Asked a question", meeting: "Wants to meet", not_now: "Not right now", not_interested: "Not interested", other: "Something else",
};
const replyNoteSchema = z.object({ channel: z.string(), outcome: z.enum(REPLY_OUTCOMES), note: z.string().max(500).optional(), messageId: z.number().int().positive().optional() }).strict();

/**
 * What their reply said, in the person's own words and one of a few outcomes. Recorded by the person, and labelled so
 * everywhere: DealInSec never reads WhatsApp, Instagram, LinkedIn, X or Messenger. The "They replied" on the message
 * itself (which stops planned follow-ups) is recorded by the existing reply endpoints; this adds what it said.
 */
export async function recordReplyNote(user: Who, leadId: number, raw: unknown): Promise<Result<{ recorded: true }>> {
  const p = replyNoteSchema.safeParse(raw ?? {});
  const channel = p.success ? channelOf(p.data.channel) : null;
  if (!p.success || !channel) return fail(400, "invalid", "Say which channel, and what their reply said.");
  const gate = writeGate(user);
  if (gate) return gate;
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  await leadsStore.addEvent(user.organizationId!, leadId, {
    kind: "reply_recorded",
    data: { channel, outcome: p.data.outcome, ...(p.data.note?.trim() ? { note: p.data.note.trim() } : {}), ...(p.data.messageId ? { messageId: p.data.messageId } : {}) },
    actor: "user", actorUserId: user.id,
  });
  return { ok: true, recorded: true };
}

/* ── the lead's research, for the left panel ────────────────────────────── */

export interface LeadIntelligence {
  evidence: DraftEvidence;
  /** Facts read on their site (or entered by the person) vs Mika's guesses, as counts. */
  counts: { facts: number; guesses: number; datedSignals: number };
  contact: {
    name: string | null; role: string | null; email: string | null; emailSource: "you" | "website" | null; phone: string | null; contactForm: string | null;
    /** The company's own profiles found on its website (shared/social-links.ts), and the page each was on. */
    socials: SocialLinks; socialSources: Record<keyof SocialLinks, string | null>;
    /** When the website was last read for them; null = never (the Studio asks once). */
    socialsCheckedAt: string | null;
    /** The lead's location as entered, so a local phone number can be given its country code. */
    country: string | null;
  };
  sources: { url: string; host: string; items: number }[];
  /** The Client Radar company this lead came from, when there is one. */
  prospectId: number | null;
}

export async function leadIntelligence(user: Who, leadId: number, now = new Date()): Promise<Result<{ intelligence: LeadIntelligence }>> {
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  const { lead, claims } = got.detail;
  const orgId = user.organizationId!;
  let findings: EvidenceFinding[] | null = null, prospectId: number | null = null;
  try {
    const { outboundStore } = await import("../outbound/store");
    const p = await outboundStore.prospectByLead(orgId, leadId);
    if (p) { prospectId = p.id; findings = (await outboundStore.findings(orgId, p.id)) as EvidenceFinding[]; }
  } catch { findings = null; }
  let offer = { about: null as string | null, services: [] as string[] };
  try {
    const { getIdealClient } = await import("../services/ideal-client");
    const ideal = await getIdealClient(user);
    if (ideal.ok) offer = { about: ideal.profile.about, services: ideal.profile.services };
  } catch { /* the panel still shows the research without the offer match */ }
  const evidence = buildDraftEvidence({
    claims: claims.map((c) => ({ id: c.id, field: c.field, value: c.value, status: c.status, evidenceUrl: c.evidenceUrl, source: (c as { source?: string | null }).source ?? null, createdAt: c.createdAt })),
    findings, offer, now,
  });
  const confirmed = (field: string) => claims.filter((c) => c.field.trim().toLowerCase() === field && c.status === "confirmed").sort((a, b) => b.id - a.id)[0] ?? null;
  const siteEmail = confirmed("business_email"), phone = confirmed("business_phone"), form = confirmed("contact_form");
  const urls = new Map<string, number>();
  for (const x of [...evidence.profile, ...evidence.leads]) if (x.sourceUrl) urls.set(x.sourceUrl, (urls.get(x.sourceUrl) ?? 0) + 1);
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  return {
    ok: true,
    intelligence: {
      evidence,
      counts: {
        facts: claims.filter((c) => c.status === "confirmed").length,
        guesses: claims.filter((c) => c.status === "inferred").length + (findings ?? []).filter((f) => f.status === "inferred").length,
        datedSignals: evidence.leads.filter((x) => x.kind === "signal" && x.date).length,
      },
      contact: {
        name: lead.contactName ?? null, role: lead.contactRole ?? null,
        email: lead.contactEmail ?? siteEmail?.value ?? null, emailSource: lead.contactEmail ? "you" : siteEmail ? "website" : null,
        phone: phone?.value ?? null, contactForm: form?.value ?? null,
        socials: Object.fromEntries(SOCIAL_KINDS.map((k) => [k, confirmed(SOCIAL_FIELDS[k])?.value ?? null])) as unknown as SocialLinks,
        socialSources: Object.fromEntries(SOCIAL_KINDS.map((k) => [k, confirmed(SOCIAL_FIELDS[k])?.evidenceUrl ?? null])) as Record<keyof SocialLinks, string | null>,
        socialsCheckedAt: (() => { const e = got.detail.events.find((x) => x.kind === "contacts_checked"); return e ? new Date(e.createdAt as unknown as string).toISOString() : null; })(),
        country: lead.location ?? null,
      },
      sources: Array.from(urls.entries()).map(([url, items]) => ({ url, host: host(url), items })).slice(0, 8),
      prospectId,
    },
  };
}

/* ── contact links from the company's own website ───────────────────────── */

/** How long one look at the website counts, before the Studio may read it again. */
export const CONTACT_CHECK_DAYS = 7;
const CONTACT_PATH = /(contact|connect|reach|get-in-touch|enquir|inquir)/i;

/**
 * Reads the company's own homepage (and its contact page, when linked) once, and saves the social profiles and WhatsApp
 * link it finds as facts on the lead, each with the page it was on. Free: the built-in page reader only (robots.txt
 * respected, no paid reader, no model). Done at most once every CONTACT_CHECK_DAYS days per lead.
 */
export async function findContactLinks(user: Who, leadId: number, deps: { read?: (url: string) => Promise<{ ok: boolean; url?: string; links?: { href: string }[] }>; now?: Date } = {}): Promise<Result<{ socials: SocialLinks; checked: boolean }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  const { lead, events, claims } = got.detail;
  const now = deps.now ?? new Date();
  const current = () => Object.fromEntries(SOCIAL_KINDS.map((k) => [k, claims.filter((c) => c.field === SOCIAL_FIELDS[k] && c.status === "confirmed").sort((a, b) => b.id - a.id)[0]?.value ?? null])) as unknown as SocialLinks;
  const last = events.find((e) => e.kind === "contacts_checked");
  if (last && now.getTime() - new Date(last.createdAt as unknown as string).getTime() < CONTACT_CHECK_DAYS * DAY) return { ok: true, socials: current(), checked: false };
  let home: URL;
  try { home = new URL(/^https?:\/\//i.test(lead.website ?? "") ? lead.website! : `https://${lead.website ?? lead.domain ?? ""}`); } catch { return fail(400, "no_website", "This lead has no website to read."); }
  if (!lead.website && !lead.domain) return fail(400, "no_website", "This lead has no website to read.");
  const read = deps.read ?? (async (url: string) => { const { RobotsReader, builtinReader } = await import("../outbound/providers"); return new RobotsReader(builtinReader).read(url); });
  const sameSite = (u: string) => { try { const h = new URL(u).hostname.replace(/^www\./, ""); const base = home.hostname.replace(/^www\./, ""); return h === base || h.endsWith(`.${base}`); } catch { return false; } };
  const pages: { url: string; links: { href: string }[] }[] = [];
  const first = await read(`${home.protocol}//${home.hostname}/`).catch(() => null);
  if (first?.ok) {
    pages.push({ url: first.url ?? home.toString(), links: first.links ?? [] });
    const contact = (first.links ?? []).map((l) => { try { return new URL(l.href, first.url ?? home.toString()).toString(); } catch { return null; } })
      .find((u): u is string => !!u && sameSite(u) && CONTACT_PATH.test(new URL(u).pathname));
    if (contact) { const c = await read(contact).catch(() => null); if (c?.ok) pages.push({ url: c.url ?? contact, links: c.links ?? [] }); }
  }
  const have = current();
  const found: string[] = [];
  for (const page of pages) {
    const s = socialLinksFrom(page.links);
    for (const k of SOCIAL_KINDS) {
      const v = s[k];
      if (!v || have[k] || found.includes(k)) continue;
      const href = page.links.find((l) => socialLinksFrom([l])[k] === v)?.href ?? v;
      const r = await addClaim(user, leadId, { field: SOCIAL_FIELDS[k], value: v, status: "confirmed", evidenceUrl: page.url, evidenceSnippet: `Link on their website: ${href}`.slice(0, 500) }, { actor: "agent" });
      if (r.ok) { have[k] = v; found.push(k); }
    }
  }
  await leadsStore.addEvent(user.organizationId!, leadId, { kind: "contacts_checked", data: { read: pages.length, found }, actor: "agent", actorUserId: user.id, quiet: true });
  return { ok: true, socials: have, checked: true };
}

/* ── overview: honest numbers ───────────────────────────────────────────── */

export interface OverviewNumbers {
  days: number;
  readyToContact: number | null;
  draftsWaiting: number | null;
  /** Sends the person told DealInSec about (email from their own app, and every other channel). */
  markedSentByYou: number | null;
  /** Emails DealInSec itself sent from the person's connected Gmail. */
  sentFromGmail: number | null;
  /** Replies the person recorded. */
  repliesRecordedByYou: number | null;
  /** Replies DealInSec found in a connected Gmail. */
  repliesFoundInGmail: number | null;
  followUpsDue: number | null;
  interested: number | null;
  meetings: number | null;
  byChannel: { channel: Channel; drafts: number; markedSent: number; replies: number }[];
}

const rows = (r: unknown) => ((r as { rows?: unknown[] })?.rows ?? []) as Record<string, unknown>[];
async function count(q: ReturnType<typeof sql>): Promise<number | null> {
  try { return Number(rows(await db.execute(q))[0]?.n ?? 0); } catch { return null; } // a table not set up yet: "couldn't count", never a made-up 0
}

/** The overview's numbers for the last `days` days (follow-ups due and drafts waiting are as of now). */
export async function outreachOverview(user: Who, raw: { days?: unknown } = {}, now = new Date()): Promise<Result<{ overview: OverviewNumbers }>> {
  const gate = readGate(user);
  if (gate) return gate;
  const days = [7, 30, 90].includes(Number(raw.days)) ? Number(raw.days) : 30;
  const org = user.organizationId!;
  const since = new Date(now.getTime() - days * DAY).toISOString();
  const endOfToday = `${now.toISOString().slice(0, 10)}T23:59:59.999Z`;
  const [readyToContact, emailDrafts, channelDrafts, emailManual, channelManual, gmailSent, emailReplies, channelReplies, gmailReplies, followUpsDue, interested, meetings] = await Promise.all([
    count(sql`SELECT count(*)::int AS n FROM leads l WHERE l.organization_id = ${org} AND l.archived_at IS NULL AND NOT l.do_not_contact
      AND l.status IN ('new', 'researching', 'qualified')
      AND (l.contact_email IS NOT NULL OR EXISTS (SELECT 1 FROM lead_claims c WHERE c.organization_id = l.organization_id AND c.lead_id = l.id AND c.field = 'business_email' AND c.status = 'confirmed'))`),
    count(sql`SELECT count(*)::int AS n FROM lead_messages WHERE organization_id = ${org} AND direction = 'out' AND status IN ('draft', 'approved')`),
    count(sql`SELECT count(*)::int AS n FROM channel_messages WHERE organization_id = ${org} AND direction = 'out' AND status IN ('draft', 'approved')`),
    count(sql`SELECT count(*)::int AS n FROM lead_events WHERE organization_id = ${org} AND kind = 'message_sent' AND data->>'channel' = 'manual' AND created_at >= ${since}::timestamp`),
    count(sql`SELECT count(*)::int AS n FROM channel_messages WHERE organization_id = ${org} AND direction = 'out' AND status = 'sent' AND sent_via = 'manual' AND sent_at >= ${since}::timestamp`),
    count(sql`SELECT count(*)::int AS n FROM lead_events WHERE organization_id = ${org} AND kind = 'message_sent' AND data->>'channel' IN ('gmail', 'gmail_confirmed') AND created_at >= ${since}::timestamp`),
    count(sql`SELECT count(*)::int AS n FROM outreach_events WHERE organization_id = ${org} AND kind = 'replied' AND source = 'manual' AND created_at >= ${since}::timestamp`),
    count(sql`SELECT count(*)::int AS n FROM channel_messages WHERE organization_id = ${org} AND direction = 'out' AND replied_at IS NOT NULL AND sent_via = 'manual' AND replied_at >= ${since}::timestamp`),
    count(sql`SELECT count(*)::int AS n FROM outreach_events WHERE organization_id = ${org} AND kind = 'replied' AND source <> 'manual' AND created_at >= ${since}::timestamp`),
    count(sql`SELECT count(*)::int AS n FROM lead_tickets t JOIN leads l ON l.organization_id = t.organization_id AND l.id = t.lead_id
      WHERE t.organization_id = ${org} AND t.kind = 'follow_up' AND t.status = 'open' AND t.due_at IS NOT NULL AND t.due_at <= ${endOfToday}::timestamp AND l.archived_at IS NULL`),
    count(sql`SELECT count(DISTINCT lead_id)::int AS n FROM lead_events WHERE organization_id = ${org} AND kind = 'reply_recorded' AND data->>'outcome' = 'interested' AND created_at >= ${since}::timestamp`),
    count(sql`SELECT count(DISTINCT lead_id)::int AS n FROM lead_events WHERE organization_id = ${org} AND created_at >= ${since}::timestamp
      AND ((kind = 'status_changed' AND data->>'to' = 'meeting') OR (kind = 'reply_recorded' AND data->>'outcome' = 'meeting'))`),
  ]);
  const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
  let byChannel: OverviewNumbers["byChannel"] = [];
  try {
    const ch = rows(await db.execute(sql`SELECT channel,
        count(*) FILTER (WHERE status IN ('draft', 'approved'))::int AS drafts,
        count(*) FILTER (WHERE status = 'sent' AND sent_via = 'manual' AND sent_at >= ${since}::timestamp)::int AS sent,
        count(*) FILTER (WHERE replied_at IS NOT NULL AND replied_at >= ${since}::timestamp)::int AS replies
      FROM channel_messages WHERE organization_id = ${org} AND direction = 'out' GROUP BY channel`));
    byChannel = ch.map((r) => ({ channel: r.channel as Channel, drafts: Number(r.drafts), markedSent: Number(r.sent), replies: Number(r.replies) }));
  } catch { byChannel = []; }
  byChannel.unshift({ channel: "email", drafts: emailDrafts ?? 0, markedSent: (emailManual ?? 0) + (gmailSent ?? 0), replies: (emailReplies ?? 0) + (gmailReplies ?? 0) });
  return {
    ok: true,
    overview: {
      days, readyToContact, draftsWaiting: add(emailDrafts, channelDrafts), markedSentByYou: add(emailManual, channelManual), sentFromGmail: gmailSent,
      repliesRecordedByYou: add(emailReplies, channelReplies), repliesFoundInGmail: gmailReplies, followUpsDue, interested, meetings, byChannel,
    },
  };
}
