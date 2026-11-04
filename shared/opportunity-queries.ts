/**
 * Opportunity-led searches: when the ICP carries the person's own services, the plan also looks for businesses that
 * SAY they want outside help with exactly that work, not only for companies that match a description. Pure and
 * deterministic: fixed templates, no model, no network. shared/icp.ts interleaves these with its company phrasings
 * under the same budget, dedup (queryKey) and checks (sanitizeQuery) — an ICP with no services gets exactly the
 * searches it got before this module existed.
 */

export const SEGMENTS = ["agencies", "saas", "ecommerce", "consultants", "local"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABEL: Record<Segment, string> = {
  agencies: "Small agencies",
  saas: "Solo founders & small SaaS",
  ecommerce: "Ecommerce stores",
  consultants: "Consultants & service businesses",
  local: "Local businesses",
};

/** The ICP fields this module reads. Older stored ICPs may lack them, so both are optional everywhere. */
export interface OfferIcp { services?: string[]; segment?: Segment | null }

const clean = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * One-click search profiles for who a freelancer sells to. Each only fills the ordinary ICP fields (the kind of
 * company, its other names, the size cap) plus the segment; the person still sees and edits everything before a
 * search starts. The size cap is "exclude when known to be bigger", never "require proof of being small": a company
 * that doesn't state its size is not filtered out (shared/icp.ts prospectFit).
 */
export interface SegmentPreset {
  segment: Segment; label: string; industry: string; keywords: string[]; targetMarket: string[];
  /** Applied as employeeMax. Small by default (the founder-chosen solo market); the UI offers up to 20. */
  employeeMax: number;
  note: string;
}
export const SEGMENT_PRESETS: readonly SegmentPreset[] = [
  { segment: "agencies", label: "Small agencies", industry: "digital agency", keywords: ["marketing agency", "design studio", "creative agency"], targetMarket: [], employeeMax: 20, note: "Agencies that take on more client work than their own team can deliver." },
  { segment: "saas", label: "Solo founders & small SaaS", industry: "software startup", keywords: ["SaaS", "indie software company"], targetMarket: [], employeeMax: 5, note: "Small product teams that buy help instead of hiring." },
  { segment: "ecommerce", label: "Ecommerce stores", industry: "ecommerce brand", keywords: ["online store", "D2C brand"], targetMarket: [], employeeMax: 5, note: "Stores run by one or two people who outsource the technical work." },
  { segment: "consultants", label: "Consultants & service businesses", industry: "consulting firm", keywords: ["independent consultant", "professional services firm"], targetMarket: [], employeeMax: 5, note: "Independent professionals who buy what they don't do themselves." },
  { segment: "local", label: "Local businesses", industry: "local service business", keywords: [], targetMarket: [], employeeMax: 5, note: "Small businesses found online. For map listings in one city, use the Local businesses source." },
];

/**
 * The opportunity phrasings for one place ("" = worldwide): per service, the ways a business asks for outside help
 * with that work — segment-specific wording when a segment is chosen, plain freelancer wording otherwise. Templates
 * only; shared/icp.ts sanitizes, dedups and caps them with the company phrasings.
 */
export function opportunityPhrasings(i: OfferIcp, place: string): string[] {
  const services = (i.services ?? []).map(clean).filter(Boolean).slice(0, 3);
  if (!services.length) return [];
  const seg = i.segment ?? null;
  const at = (q: string) => (clean(place) ? `${q} ${clean(place)}` : q);
  const t: string[] = [];
  for (const s of services) {
    if (seg === "agencies") { t.push(at(`agency looking for freelance ${s}`)); t.push(at(`white label ${s} partner for agencies`)); }
    else if (seg === "saas") { t.push(at(`startup looking for freelance ${s}`)); t.push(at(`${s} freelancer for early stage startup`)); }
    else if (seg === "ecommerce") { t.push(at(`online store looking for ${s} help`)); t.push(at(`ecommerce ${s} freelancer`)); }
    else if (seg === "consultants") { t.push(at(`consultant looking for ${s} help`)); t.push(at(`${s} for independent consultants`)); }
    else if (seg === "local") { t.push(at(`small business looking for ${s}`)); t.push(at(`local business ${s} help`)); }
    else { t.push(at(`looking for freelance ${s}`)); t.push(at(`hire ${s} freelancer`)); }
  }
  return t;
}

/** The visible "Searching as:" line — "web development + AI automation → Small agencies" — or "" with nothing to say. */
export function offerLine(i: OfferIcp): string {
  const services = (i.services ?? []).map(clean).filter(Boolean);
  const seg = i.segment && (SEGMENTS as readonly string[]).includes(i.segment) ? SEGMENT_LABEL[i.segment] : "";
  if (services.length && seg) return `${services.join(" + ")} → ${seg}`;
  return services.join(" + ") || seg;
}
