/**
 * Client profiles: who a workspace wants as clients, saved and named, as many as it needs (a freelancer has one, an
 * agency one per kind of client it goes after). Pure: no model, no network, no database.
 *
 * A profile is NOT a second copy of a search. It is what a search starts from: `icpFromProfile` turns it into the
 * search profile Client Radar already confirms and runs (shared/icp.ts), by plain rules — so starting from a saved
 * profile costs no model call, and the person still sees and edits every chip before anything is spent.
 *
 * It is also not the workspace's "ideal client" (client_profiles, shared/fit.ts): that one row says what the workspace
 * itself sells and its standing "never these", and is applied to every search. A profile says who to look for THIS time.
 *
 * Two fields go beyond a search:
 *   buying signals   which kinds of event the person treats as a reason to get in touch (a subset of SIGNAL_TYPES)
 *   requirements     what a company must have before it is worth their time
 * Both are judged by `profileMatch`, from the evidence already stored on a company — a rule, never a model's opinion,
 * and never a change to "Ready" or the score (shared/prospect.ts), which stay exactly as they were.
 *
 * Outreach preferences are saved with the profile. Nothing in a search uses them. The tone and the note are read when
 * a FIRST message is drafted (server/profiles/style.ts), an email or a short message for WhatsApp, LinkedIn or X: for
 * a lead found from this profile, and for a campaign built for it. They change wording only; every drafting rule and
 * check stays. The channels are shown on the lead's page as a reminder; nothing is sent or chosen by them.
 */
import { z } from "zod";
import { DEFAULT_QUANTITY, DEFAULT_ROLES, icpSchema, type Icp } from "./icp";
import { REQUIREMENT_KEYS, REQUIREMENT_LABEL, WANTED_SIGNALS, type RequirementKey, type WantedSignal } from "./profile-keys";

export const MAX_ACQUISITION_PROFILES = 20;
export const PROFILE_KINDS = ["freelancer", "marketing_agency", "dev_agency", "custom"] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];
export const PROFILE_KIND_LABEL: Record<ProfileKind, string> = { freelancer: "Freelancer", marketing_agency: "Marketing agency", dev_agency: "Software agency", custom: "Custom" };

export const OUTREACH_CHANNELS = ["email", "whatsapp", "linkedin"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];
export const OUTREACH_CHANNEL_LABEL: Record<OutreachChannel, string> = { email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn" };
export const OUTREACH_TONES = ["friendly", "formal", "direct"] as const;
export type OutreachTone = (typeof OUTREACH_TONES)[number];
export const OUTREACH_TONE_LABEL: Record<OutreachTone, string> = { friendly: "Friendly", formal: "Formal", direct: "Short and direct" };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const phrase = (max: number) => z.string().transform(clean).pipe(z.string().min(1).max(max));
/** A list of short phrases: trimmed, de-duplicated without regard to case, capped. */
const phrases = (n: number, max: number) => z.array(phrase(max)).max(n).default([]).transform((xs) => {
  const seen = new Set<string>();
  return xs.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
});
const uniq = <T,>(xs: T[]) => Array.from(new Set(xs));

export const outreachPrefsSchema = z.object({
  channels: z.array(z.enum(OUTREACH_CHANNELS)).max(3).default(["email"]).transform(uniq),
  tone: z.enum(OUTREACH_TONES).default("friendly"),
  /** The person's own note for whoever writes the message ("mention our Shopify work"). Never sent anywhere by itself. */
  note: z.string().transform(clean).pipe(z.string().max(280)).default(""),
});
export type OutreachPrefs = z.infer<typeof outreachPrefsSchema>;
export const DEFAULT_OUTREACH: OutreachPrefs = { channels: ["email"], tone: "friendly", note: "" };

/** The outreach preferences of one saved profile, as drafting reads them (server/profiles/style.ts). */
export interface ProfileStyle { profileId: number; profileName: string; tone: OutreachTone; note: string; /** The channels the person ticked for these clients. Shown to them; nothing sends by it. */ channels: OutreachChannel[] }
/** What a page may show about the style a lead's drafts follow. The note's words stay on the profile. */
export interface ProfileStyleView { profileName: string; tone: OutreachTone; toneLabel: string; hasNote: boolean; channels: { key: OutreachChannel; label: string }[] }
export const profileStyleView = (s: ProfileStyle | null | undefined): ProfileStyleView | null => (s
  ? { profileName: s.profileName, tone: s.tone, toneLabel: OUTREACH_TONE_LABEL[s.tone], hasNote: !!s.note.trim(), channels: s.channels.map((key) => ({ key, label: OUTREACH_CHANNEL_LABEL[key] })) }
  : null);

const size = z.number().int().min(1).max(1_000_000).nullable().default(null);

export const acquisitionProfileSchema = z.object({
  name: z.string().transform(clean).pipe(z.string().min(1, "Give the profile a name.").max(80)),
  kind: z.enum(PROFILE_KINDS).default("custom"),
  /** What the workspace sells to these clients. */
  services: phrases(6, 60),
  /** The kinds of company to look for. A search covers one kind at a time; the person picks which. */
  industries: z.array(phrase(80)).min(1, "Add at least one kind of company to look for.").max(8).transform((xs) => {
    const seen = new Set<string>();
    return xs.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }),
  /** Other words such companies use for themselves. */
  keywords: phrases(8, 60),
  /** ISO 3166-1 alpha-2 codes. */
  countries: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter country code.")).max(5).default([]).transform(uniq),
  /** Cities or regions, free text. */
  locations: phrases(5, 60),
  employeeMin: size,
  employeeMax: size,
  /** Kinds of company never to return. */
  exclusions: phrases(10, 60),
  signals: z.array(z.enum(WANTED_SIGNALS)).max(WANTED_SIGNALS.length).default([]).transform(uniq),
  requirements: z.array(z.enum(REQUIREMENT_KEYS)).max(REQUIREMENT_KEYS.length).default([]).transform(uniq),
  /** Who to contact there, most relevant first. */
  roles: phrases(6, 60),
  outreach: outreachPrefsSchema.default(DEFAULT_OUTREACH),
}).superRefine((p, ctx) => {
  if (p.employeeMin !== null && p.employeeMax !== null && p.employeeMin > p.employeeMax) ctx.addIssue({ code: "custom", path: ["employeeMin"], message: "The smallest company size must not be bigger than the largest." });
  // "One of your buying signals" with no buying signal ticked could never be met: refuse it rather than save a profile nothing can satisfy.
  if (p.requirements.includes("wanted_signal") && !p.signals.length) ctx.addIssue({ code: "custom", path: ["requirements"], message: "Tick at least one buying signal, or remove that requirement." });
});
export type AcquisitionProfileInput = z.infer<typeof acquisitionProfileSchema>;

/** A saved profile as the app shows it. */
export interface AcquisitionProfile extends AcquisitionProfileInput { id: number; isDefault: boolean; createdAt: string; updatedAt: string }

/* ── templates ──────────────────────────────────────────────────────────── */

export interface ProfileTemplate { kind: Exclude<ProfileKind, "custom">; label: string; note: string; profile: AcquisitionProfileInput }

const tpl = (kind: ProfileTemplate["kind"], label: string, note: string, p: Partial<AcquisitionProfileInput> & Pick<AcquisitionProfileInput, "name" | "industries">): ProfileTemplate =>
  ({ kind, label, note, profile: acquisitionProfileSchema.parse({ kind, ...p }) });

/**
 * Starting points, India first. Every value is a suggestion the person edits before saving: the kinds of company, the
 * sizes and the signals are the common case for that kind of seller, not a claim about any market. Services are left
 * empty on purpose — only the person knows what they sell; the app fills in the ones saved in Settings.
 */
export const PROFILE_TEMPLATES: ProfileTemplate[] = [
  tpl("freelancer", "Freelancer", "Small teams that buy help instead of hiring: agencies with overflow work, online stores, early startups.", {
    name: "Small businesses that outsource",
    industries: ["digital agency", "ecommerce brand", "software startup"],
    keywords: ["marketing agency", "D2C brand", "online store"],
    countries: ["IN"], employeeMax: 20,
    signals: ["HIRING", "NEW_SERVICE", "FUNDING"],
    requirements: ["contact_route", "recent_signal"],
    roles: ["Founder", "Owner", "CEO", "Head of Marketing"],
    outreach: { channels: ["email", "whatsapp"], tone: "friendly", note: "" },
  }),
  tpl("marketing_agency", "Marketing agency", "Brands with money to spend on growth: funded, expanding, or opening somewhere new.", {
    name: "Brands that need growth",
    industries: ["D2C brand", "ecommerce brand", "edtech company", "real estate developer", "healthcare clinic"],
    keywords: ["consumer brand", "online store"],
    countries: ["IN"], employeeMin: 5, employeeMax: 200,
    signals: ["FUNDING", "EXPANSION", "NEW_LOCATION", "NEW_SERVICE", "HIRING"],
    requirements: ["decision_maker", "recent_signal"],
    roles: ["Founder", "CMO", "Head of Marketing", "Marketing Manager", "Head of Growth"],
    outreach: { channels: ["email", "linkedin"], tone: "friendly", note: "" },
  }),
  tpl("dev_agency", "Software agency", "Companies that need a product built or rebuilt: newly funded, hiring engineers, or changing their technology.", {
    name: "Companies that need software built",
    industries: ["software startup", "fintech company", "SaaS company", "healthtech company", "logistics company"],
    keywords: ["tech startup", "product company"],
    countries: ["IN", "US"], employeeMin: 5, employeeMax: 500,
    signals: ["FUNDING", "HIRING", "TECH_CHANGE", "NEW_SERVICE", "NEW_LEADERSHIP"],
    requirements: ["decision_maker", "recent_signal"],
    roles: ["Founder", "CTO", "CEO", "Head of Engineering", "Head of Product"],
    outreach: { channels: ["email", "linkedin"], tone: "direct", note: "" },
  }),
];
export const templateFor = (kind: string): ProfileTemplate | null => PROFILE_TEMPLATES.find((t) => t.kind === kind) ?? null;

/* ── a profile as a search ──────────────────────────────────────────────── */

type ProfileLike = Pick<AcquisitionProfileInput, "name" | "services" | "industries" | "keywords" | "countries" | "locations" | "employeeMin" | "employeeMax" | "exclusions" | "signals" | "requirements" | "roles"> & { id?: number };

/**
 * The search profile for ONE kind of company from a saved profile, by plain rules: nothing is invented and no model is
 * asked. `industry` must be one of the profile's own kinds (any case); anything else, or none, means the first one.
 * The other kinds are NOT added as keywords — "edtech company" is not another name for "D2C brand", and mixing them
 * would make one search look for two different things. Null only when the result would not be a valid search.
 */
export function icpFromProfile(p: ProfileLike, industry?: string | null): Icp | null {
  const wanted = clean(String(industry ?? "")).toLowerCase();
  const kind = p.industries.find((x) => x.toLowerCase() === wanted) ?? p.industries[0];
  if (!kind) return null;
  const range = p.employeeMin !== null && p.employeeMax !== null && p.employeeMin > p.employeeMax ? { employeeMin: null, employeeMax: null } : { employeeMin: p.employeeMin, employeeMax: p.employeeMax };
  const out = icpSchema.safeParse({
    industry: kind, keywords: p.keywords, countries: p.countries, locations: p.locations, ...range,
    exclusions: p.exclusions, services: p.services, quantity: DEFAULT_QUANTITY,
    // No roles saved = the search's own defaults (founder, owner, …), exactly as a typed request gets.
    roles: p.roles.length ? p.roles : DEFAULT_ROLES,
    signals: p.signals, requirements: p.requirements,
    ...(p.id ? { profile: { id: p.id, name: p.name } } : {}),
  });
  return out.success ? out.data : null;
}

/* ── a company against a profile ────────────────────────────────────────── */

/** What `profileMatch` reads from a company: already on every prospect card (server/outbound/service.ts prospectCard). */
export interface MatchCard {
  /** Verified email, a public route (business email or confirmed contact form), or none. */
  contact: "verified" | "public" | "none";
  /** A senior decision-maker is named. */
  hasDecisionMaker: boolean;
  /** Timing of its best signal (shared/prospect.ts timingOf): "strong" and "context" are dated within 12 months. */
  timing: string;
  /** Types of its confirmed signals that are not over a year old. */
  signalTypes: string[];
}
export interface RequirementResult { key: RequirementKey; label: string; met: boolean }
export interface ProfileMatch {
  /** One entry per requirement the profile asks for, in the profile's order. Empty = the profile asks for nothing. */
  requirements: RequirementResult[];
  met: number; total: number;
  /** Every requirement is met (true when there are none: a profile that asks for nothing excludes nothing). */
  meetsAll: boolean;
  /** The profile's buying signals that were found on this company. */
  signalsFound: WantedSignal[];
}

const MET: Record<RequirementKey, (c: MatchCard, found: WantedSignal[]) => boolean> = {
  contact_route: (c) => c.contact !== "none" || c.hasDecisionMaker,
  decision_maker: (c) => c.hasDecisionMaker,
  verified_email: (c) => c.contact === "verified",
  recent_signal: (c) => c.timing === "strong" || c.timing === "context",
  wanted_signal: (_c, found) => found.length > 0,
};

/**
 * Whether a company has what a profile asks for. A rule over stored evidence: it says what was FOUND, so "not met"
 * means "we have not found it", never "they don't have it" — a company nobody researched meets almost nothing.
 */
export function profileMatch(want: { signals?: readonly string[] | null; requirements?: readonly string[] | null }, card: MatchCard): ProfileMatch {
  const has = new Set(card.signalTypes);
  const signalsFound = (WANTED_SIGNALS as readonly string[]).filter((s) => (want.signals ?? []).includes(s) && has.has(s)) as WantedSignal[];
  const requirements = (REQUIREMENT_KEYS as readonly RequirementKey[]).filter((k) => (want.requirements ?? []).includes(k))
    .map((key) => ({ key, label: REQUIREMENT_LABEL[key], met: MET[key](card, signalsFound) }));
  const met = requirements.filter((r) => r.met).length;
  return { requirements, met, total: requirements.length, meetsAll: met === requirements.length, signalsFound };
}
