/**
 * DealInSec AI League: three coworkers, one runtime (server/ai-league). Pure: the server, the browser and the tests
 * read the same identities, task templates, statuses and schedule arithmetic.
 *
 *   Nibo  Opportunity Hunter  finds companies with evidence (AI Outbound) and saves the qualified ones as leads
 *   Mika  Deal Specialist     drafts first messages from verified facts; nothing is sent without the person's approval
 *   Zee   Business Guardian   briefs the person on what needs them, from the records themselves
 *
 * They work as a team: in a chat a coworker can ask a teammate for help (a read-only answer from the teammate's own
 * records) or hand work to a teammate (always with the person's approval), and a "team huddle" is a short background
 * brainstorm between the three, ending in a summary and next steps. Talking changes nothing; doing still asks.
 */
import { z } from "zod";

export const BOTS = ["nibo", "mika", "zee"] as const;
export type Bot = (typeof BOTS)[number];
export const isBot = (v: unknown): v is Bot => typeof v === "string" && (BOTS as readonly string[]).includes(v);

export interface BotIdentity {
  bot: Bot;
  name: string;
  role: string;
  /** One sentence: what they do for you. */
  pitch: string;
  /** How they speak (used in their system prompt and their empty states). */
  voice: string;
  /** Tailwind-friendly identity colours, from the mascots (Nibo blue, Mika pink, Zee green); light and dark both read well. */
  accent: { fg: string; bg: string; ring: string; soft: string };
  suggestions: string[];
}

export const BOT_IDENTITY: Record<Bot, BotIdentity> = {
  nibo: {
    bot: "nibo", name: "Nibo", role: "Opportunity Hunter",
    pitch: "Finds companies that fit what you sell, checks each one's own website, and saves the qualified ones to Leads with the evidence.",
    voice: "curious, quick and evidence-first: says what was found and where, and plainly what wasn't",
    accent: { fg: "text-blue-700 dark:text-blue-300", bg: "bg-blue-600", ring: "ring-blue-500/40", soft: "bg-blue-50 dark:bg-blue-950/40" },
    suggestions: ["Find 10 dental clinics in Siliguri that could use a better website", "Research 10 UK marketing agencies with 5–50 people", "Ask Mika how she would open with my newest leads"],
  },
  mika: {
    bot: "mika", name: "Mika", role: "Deal Specialist",
    pitch: "Writes first messages to your leads from what's been verified about them, and lines them up for your approval. Nothing is sent without you.",
    voice: "warm, thoughtful and professional: short, specific messages, never pushy, never invented",
    accent: { fg: "text-rose-700 dark:text-rose-300", bg: "bg-rose-600", ring: "ring-rose-500/40", soft: "bg-rose-50 dark:bg-rose-950/40" },
    suggestions: ["Draft first messages for my newest researched leads", "Which leads are waiting on a follow-up?", "Ask Zee which clients owe us money before I follow up"],
  },
  zee: {
    bot: "zee", name: "Zee", role: "Business Guardian",
    pitch: "Briefs you on what needs you today, from your own records: overdue invoices, quotes waiting, follow-ups due.",
    voice: "calm, organized and reassuring: leads with what matters most and links to the record",
    accent: { fg: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-600", ring: "ring-emerald-500/40", soft: "bg-emerald-50 dark:bg-emerald-950/40" },
    suggestions: ["Give me today's business briefing", "What's overdue right now?", "Hold a team huddle: how do we land 3 new clients this month?"],
  },
};

/* ── tasks ───────────────────────────────────────────────────────────────── */

export const TASKS = ["nibo.find_clients", "mika.first_messages", "zee.briefing", "team.huddle"] as const;
export type LeagueTask = (typeof TASKS)[number];
/** The coworker a task belongs to. A huddle belongs to whoever leads it (see botForTask); "zee" is only its default. */
export const TASK_BOT: Record<LeagueTask, Bot> = { "nibo.find_clients": "nibo", "mika.first_messages": "mika", "zee.briefing": "zee", "team.huddle": "zee" };
export const botForTask = (task: LeagueTask, input: unknown): Bot => {
  const lead = (input as { lead?: unknown } | null)?.lead;
  return task === "team.huddle" && isBot(lead) ? lead : TASK_BOT[task];
};
export const TASK_LABEL: Record<LeagueTask, string> = { "nibo.find_clients": "Find potential clients", "mika.first_messages": "Draft first messages", "zee.briefing": "Business briefing", "team.huddle": "Team huddle" };

/** Hard limits the server enforces whatever a model or a request says. */
export const LEAGUE_LIMITS = {
  leadsPerRun: 5, draftsPerRun: 5, requestChars: 500,
  /** A huddle: each coworker speaks once per round, then the lead sums up. */
  huddleRounds: 2,
  /** Teammate consultations a coworker may make while answering one message (a teammate never consults further). */
  consultsPerReply: 2,
} as const;

export const TASK_INPUT = {
  "nibo.find_clients": z.object({
    request: z.string().trim().min(8, "Say who you're looking for and where, for example \"10 dental clinics in Siliguri\".").max(LEAGUE_LIMITS.requestChars),
    /** Save the qualified ones to Leads (at most leadsPerRun); otherwise they stay in AI Outbound for you to pick. */
    saveLeads: z.boolean().default(true),
    maxLeads: z.number().int().min(1).max(LEAGUE_LIMITS.leadsPerRun).default(3),
  }).strict(),
  "mika.first_messages": z.object({
    /** Specific leads, or (empty) the newest researched leads with nothing sent yet. */
    leadIds: z.array(z.number().int().positive()).max(LEAGUE_LIMITS.draftsPerRun).default([]),
    max: z.number().int().min(1).max(LEAGUE_LIMITS.draftsPerRun).default(3),
  }).strict(),
  "zee.briefing": z.object({}).strict(),
  "team.huddle": z.object({
    topic: z.string().trim().min(8, "Say what the team should think about, for example \"How do we get 5 new dental clients this month?\"").max(LEAGUE_LIMITS.requestChars),
    lead: z.enum(BOTS).default("zee"),
  }).strict(),
} as const satisfies Record<LeagueTask, z.ZodTypeAny>;
export type TaskInput<T extends LeagueTask> = z.infer<(typeof TASK_INPUT)[T]>;
export const isTask = (v: unknown): v is LeagueTask => typeof v === "string" && (TASKS as readonly string[]).includes(v);

/* ── runs ────────────────────────────────────────────────────────────────── */

export const RUN_STATUSES = ["queued", "running", "waiting", "completed", "partial", "failed", "cancelled"] as const;
export type LeagueRunStatus = (typeof RUN_STATUSES)[number];
export const TERMINAL: readonly LeagueRunStatus[] = ["completed", "partial", "failed", "cancelled"];
export const isTerminal = (s: string) => (TERMINAL as readonly string[]).includes(s);
export const RUN_STATUS_LABEL: Record<LeagueRunStatus, string> = {
  queued: "Queued", running: "Working", waiting: "Waiting on research", completed: "Done", partial: "Partly done", failed: "Didn't finish", cancelled: "Cancelled",
};

/** A coworker's state for the roster, from real rows only. */
export type BotStatus = "available" | "working" | "needs_you" | "attention";
export const BOT_STATUS_LABEL: Record<BotStatus, string> = { available: "Available", working: "Working", needs_you: "Waiting for you", attention: "Needs attention" };

/** What every report says, whatever the task: counts that come from what was done, never estimates. */
export interface LeagueReport {
  headline: string;
  counts: { label: string; value: number }[];
  items: { title: string; detail?: string; href?: string; status: "done" | "skipped" | "failed" | "info" | "needs_you"; sources?: string[]; /** Who said it (a huddle's turns and next steps). */ bot?: Bot }[];
  next?: { label: string; href: string } | null;
  /** Zee: a short summary written from the items above (never new facts). */
  summary?: string | null;
  notes?: string[];
}

/* ── schedules ───────────────────────────────────────────────────────────── */

export const FREQUENCIES = ["daily", "weekdays", "weekly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_LABEL: Record<Frequency, string> = { daily: "Every day", weekdays: "Every weekday", weekly: "Every week" };
export const SCHEDULABLE: readonly LeagueTask[] = ["zee.briefing", "mika.first_messages", "nibo.find_clients"];

export const scheduleInput = z.object({
  task: z.enum(TASKS),
  input: z.record(z.unknown()).default({}),
  frequency: z.enum(FREQUENCIES),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time like 09:00."),
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  timezone: z.string().min(3).max(64),
}).strict();

export function validTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** The wall-clock parts of an instant in a timezone. */
function zoned(at: Date, tz: string): { y: number; m: number; d: number; hh: number; mm: number; dow: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(at).map((p) => [p.type, p.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), hh: Number(parts.hour), mm: Number(parts.minute), dow };
}

/** The UTC instant of a wall-clock time on a calendar day in a timezone (DST-safe: re-checked once). */
export function zonedInstant(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const z = zoned(new Date(guess), tz);
    const shownAsUtc = Date.UTC(z.y, z.m - 1, z.d, z.hh, z.mm);
    guess += Date.UTC(y, m - 1, d, hh, mm) - shownAsUtc;
  }
  return new Date(guess);
}

/**
 * The next time a schedule should run, strictly after `after`. Missed runs are NOT replayed: a schedule that was due
 * while the server was down runs once when it comes back (the claim takes it), and its next time is computed from now.
 */
export function nextRunAt(s: { frequency: Frequency; timeOfDay: string; weekday: number | null; timezone: string }, after: Date): Date {
  const [hh, mm] = s.timeOfDay.split(":").map(Number);
  const start = zoned(after, s.timezone);
  for (let i = 0; i < 9; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const at = zonedInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, s.timezone);
    if (at <= after) continue;
    const dow = zoned(at, s.timezone).dow;
    if (s.frequency === "weekdays" && (dow === 0 || dow === 6)) continue;
    if (s.frequency === "weekly" && dow !== (s.weekday ?? 1)) continue;
    return at;
  }
  return new Date(after.getTime() + 7 * 86_400_000);
}
