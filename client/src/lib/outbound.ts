/** AI Outbound: the shapes the /api/outbound routes return, and their addresses. */
export const OUTBOUND_RUNS_URL = "/api/outbound/runs";
export const runUrl = (id: string) => `/api/outbound/runs/${id}`;
export const prospectUrl = (id: number, action = "") => `/api/outbound/prospects/${id}${action ? `/${action}` : ""}`;
export const ICP_URL = "/api/outbound/icp";

export interface Icp {
  industry: string; keywords: string[]; countries: string[]; locations: string[]; employeeMin: number | null; employeeMax: number | null;
  targetMarket: string[]; roles: string[]; exclusions: string[]; quantity: number;
}
export interface ParsedIcp { icp: Icp; searches: string[]; description: string; source: "model" | "rules" }

export interface Counters {
  searched: number; results: number; discovered: number; rejected: number; rejectedBy: Record<string, number>; verified: number; enriched: number;
  icpMatch: number; researched: number; signals: number; decisionMakers: number; ready: number; failed: number; searchRejectedBy?: Record<string, number>; stoppedBy?: string | null;
}
export interface RunView {
  id: string; status: "running" | "done" | "failed" | "cancelled"; stage: string; request: string; icp: Icp; description: string; quantity: number;
  counters: Partial<Counters>; costUsd: number; errorCode: string | null; createdAt: string; finishedAt: string | null;
  queries: { q: string; provider: string; done: boolean; ok?: boolean; results?: number }[];
}
export interface Evidence {
  id: number; kind: "fact" | "signal" | "decision_maker" | "opportunity"; type: string; label: string; value: string; status: string;
  source: string; url: string | null; quote: string | null; observedAt: string | null; freshness?: string; supports?: number[]; meta?: Record<string, any>;
}
export interface ScoreComponent { key: string; label: string; max: number; points: number | null; reason: string }
export interface ProspectCard {
  id: number; runItemId?: number; name: string; domain: string; website: string; status: string; stage?: string; rejectReason: string | null; rejectLabel: string | null;
  score: { total: number; knownMax: number; unknownPoints: number; confidence: "low" | "medium" | "high"; components: ScoreComponent[]; missing: string[]; readyMissing?: string[] } | null;
  ready: boolean; fit: { verdict: string; headline: string; signals: { key: string; label: string; status: string; detail: string }[] } | null;
  profile: { industry: string | null; location: string | null; country: string | null; employees: string | null; serves: string | null };
  whyNow: Evidence | null; opportunity: Evidence | null; decisionMaker: Evidence | null; evidenceCount: number; leadId: number | null; researched: boolean;
}
export interface Angle { problem: string; opportunity: string; positioning: string; targetPerson: string | null; reason: string; evidenceIds: number[]; confidence: "low" | "medium" }
export interface Brief {
  prospect: ProspectCard; facts: Evidence[]; signals: Evidence[]; people: Evidence[]; inferences: Evidence[]; opportunities: Evidence[];
  sources: { provider: string; query: string; url: string; title: string }[]; angle: Angle | null; providers: { contact: boolean };
}

export const COUNTRY_NAME: Record<string, string> = {
  US: "United States", GB: "United Kingdom", IN: "India", CA: "Canada", AU: "Australia", DE: "Germany", FR: "France", ES: "Spain", NL: "Netherlands",
  IE: "Ireland", SG: "Singapore", AE: "UAE", NZ: "New Zealand", ZA: "South Africa", PT: "Portugal", IT: "Italy", SE: "Sweden", BR: "Brazil", MX: "Mexico", JP: "Japan",
};
export const countryName = (c: string | null | undefined) => (c ? COUNTRY_NAME[c] ?? c : "");

export const RUN_STAGE_LABEL: Record<string, string> = {
  search: "Searching the web", verify: "Checking each company's website", enrich: "Reading what each company does", research: "Looking for reasons to reach out now",
  finalize: "Scoring", done: "Done",
};
export const RUN_ERROR: Record<string, string> = {
  daily_limit: "Today's allowance ran out partway; what was found so far is below.",
  search_unavailable: "Web search didn't answer, so nothing could be found. Try again later.",
  cap_unavailable: "The AI allowance couldn't be checked, so the search stopped safely.",
  cancelled: "You stopped this search.",
  stuck: "This search stopped responding and was ended.",
};
