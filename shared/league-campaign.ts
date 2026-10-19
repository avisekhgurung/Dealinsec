/**
 * Nibo's research campaign ("nibo.campaign"): the rules about time and batches, pure so the server, the chat tool, the
 * browser and the tests agree.
 *
 *   start       when research begins (now, or a scheduled time)
 *   work until  the execution deadline: no new search starts after it (default: shortly before delivery, so the
 *               report is ready on time)
 *   deliver at  the delivery deadline: the report (complete, or partial with its coverage stated) is delivered then
 *   hard stop   a campaign never runs longer than LEAGUE_LIMITS.campaignMaxHours, whatever it was asked
 *
 * All instants are UTC; the timezone is only how the person said them and how reports show them.
 */
import { LEAGUE_LIMITS, validTimeZone, zonedInstant } from "./ai-league";
import type { Icp } from "./icp";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** Left between the end of research and delivery, to write the report and deliver it on time. */
export const DELIVERY_RESERVE_MS = 15 * MIN;
/** With no deadline given, research runs at most this long. */
export const DEFAULT_WORK_MS = 4 * HOUR;
/** After the delivery time (or the end of work, if none), a stuck campaign is stopped and reported anyway. */
const GRACE_MS = 30 * MIN;

export interface CampaignTimesInput { startAt: string | null; workUntil: string | null; deliverAt: string | null; timezone: string }
export interface CampaignTimes { startAt: Date; workUntil: Date; deliverAt: Date | null; hardStop: Date }

export function campaignTimes(i: CampaignTimesInput, createdAt: Date): CampaignTimes {
  const startAt = i.startAt ? new Date(Math.max(new Date(i.startAt).getTime(), createdAt.getTime())) : createdAt;
  const deliverAt = i.deliverAt ? new Date(i.deliverAt) : null;
  const workUntil = i.workUntil
    ? new Date(i.workUntil)
    : deliverAt
      ? new Date(Math.max(startAt.getTime(), deliverAt.getTime() - DELIVERY_RESERVE_MS))
      : new Date(startAt.getTime() + DEFAULT_WORK_MS);
  const cap = startAt.getTime() + LEAGUE_LIMITS.campaignMaxHours * HOUR;
  const hardStop = new Date(Math.min(cap, (deliverAt ?? workUntil).getTime() + GRACE_MS));
  return { startAt, workUntil: new Date(Math.min(workUntil.getTime(), cap)), deliverAt, hardStop };
}

/** Why these times can't be accepted, in the person's words, or null. */
export function campaignTimesProblem(i: CampaignTimesInput, now: Date): string | null {
  if (!validTimeZone(i.timezone)) return "That timezone isn't recognised.";
  const horizon = now.getTime() + LEAGUE_LIMITS.campaignHorizonDays * DAY;
  const t = campaignTimes(i, now);
  if (i.deliverAt) {
    if (t.deliverAt!.getTime() < now.getTime() + 30 * MIN) return "The report time is too soon: give the research at least 30 minutes.";
    if (t.deliverAt!.getTime() > horizon) return `The report time is too far ahead: at most ${LEAGUE_LIMITS.campaignHorizonDays} days from now.`;
  }
  if (i.startAt && new Date(i.startAt).getTime() > horizon) return `The start time is too far ahead: at most ${LEAGUE_LIMITS.campaignHorizonDays} days from now.`;
  if (t.workUntil.getTime() <= t.startAt.getTime()) return "The research must be allowed to run after it starts.";
  if (t.deliverAt && t.workUntil.getTime() > t.deliverAt.getTime()) return "Research must end before the report is due.";
  if (t.deliverAt && t.deliverAt.getTime() - t.startAt.getTime() > LEAGUE_LIMITS.campaignMaxHours * HOUR) return `A campaign can run for at most ${LEAGUE_LIMITS.campaignMaxHours} hours.`;
  return null;
}

/** "2026-10-20T08:00" in a timezone, to a UTC instant (DST-safe). null for anything else. */
export function fromLocal(local: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(local.trim());
  if (!m || !validTimeZone(tz)) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return zonedInstant(y, mo, d, h, mi, tz);
}

/** "Tue 20 Oct, 08:00 IST": how a time is shown to the person, in their timezone. */
export function showTime(at: Date, tz: string): string {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? tz;
  return `${day}, ${time} ${zone === "GMT+5:30" ? "IST" : zone}`;
}

/** Big business cities, in order, for spreading a country-wide search across batches (one city per search). */
export const CAMPAIGN_CITIES: Record<string, readonly string[]> = {
  IN: ["Mumbai", "Bengaluru", "Delhi NCR", "Pune", "Hyderabad", "Chennai", "Ahmedabad", "Kolkata", "Jaipur", "Chandigarh", "Kochi", "Indore"],
  US: ["New York", "San Francisco", "Los Angeles", "Chicago", "Austin", "Boston", "Seattle", "Miami", "Denver", "Atlanta"],
  GB: ["London", "Manchester", "Birmingham", "Leeds", "Bristol", "Edinburgh", "Glasgow", "Liverpool"],
  CA: ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa"],
  AU: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide"],
  AE: ["Dubai", "Abu Dhabi", "Sharjah"],
};

/**
 * The profile for one batch. A country-wide profile (one country, no city) moves to the next big city each batch, so
 * successive searches find different companies; a profile with several places takes one place per batch. Otherwise
 * every batch searches the same profile, and the campaign's own de-duplication keeps repeats out of the results.
 */
export function batchIcp(icp: Icp, batch: number): { icp: Icp; place: string | null } {
  if (icp.locations.length > 1) {
    const place = icp.locations[batch % icp.locations.length];
    return { icp: { ...icp, locations: [place] }, place };
  }
  const cities = icp.locations.length === 0 && icp.countries.length === 1 ? CAMPAIGN_CITIES[icp.countries[0]] : undefined;
  if (cities?.length) {
    const place = cities[batch % cities.length];
    return { icp: { ...icp, locations: [place] }, place };
  }
  return { icp, place: icp.locations[0] ?? null };
}

/** A company's identity across batches and against Leads: its domain, lower-case, without www. */
export const domainKey = (d: string | null | undefined): string | null => {
  const s = (d ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return s && s.includes(".") ? s : null;
};
