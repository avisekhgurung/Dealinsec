/**
 * Local business discovery ("dentists in Siliguri"), next to AI Outbound's web research ("US SaaS companies"): one
 * search experience, two sources chosen by what is being looked for, never by the person's own billing country.
 *
 * Source: Google Places API (New) Text Search, when GOOGLE_PLACES_API_KEY is configured.
 *
 * Data use, from Google's terms as checked on 18 Oct 2026 (Maps Platform Terms §3.2.3, last modified 26 Aug 2026;
 * Service Specific Terms §14 Places API, last modified 15 Oct 2026; Places API Policies):
 *   - Results are shown live and NOT stored: the terms forbid caching Places content and, expressly, to "copy and save
 *     business names, addresses, or user reviews". Names, addresses, phone numbers, categories and website URLs from a
 *     listing live only in the response and the browser's memory.
 *   - Place IDs may be stored indefinitely. They are the only Places data DealInSec keeps: as the provenance of a website
 *     the person chose to research, and as the link on a lead the person saved (a Google Maps link built from the ID).
 *   - Results are attributed to Google Maps wherever they are shown, and never shown on a non-Google map.
 *   - Places content is never sent to an AI model. Relevance is judged only from what DealInSec reads on the company's
 *     own website, independently, when the person chooses to research it.
 *   - A listing with no website is an observation about the listing ("No website listed on Google Maps"), never proof
 *     that the business has no website, and never a judgement that it needs one.
 */
import { z } from "zod";

export type DiscoveryMode = "local" | "web";

/** Kinds of business people look for in a city, which a map listing covers better than web search. Lower-case words. */
const LOCAL_KINDS = [
  "dentist", "dental", "clinic", "doctor", "hospital", "pharmacy", "physio", "salon", "spa", "barber", "beauty", "gym", "fitness", "yoga",
  "restaurant", "cafe", "café", "bakery", "sweet", "caterer", "hotel", "homestay", "guest house", "resort", "coaching", "tuition", "school",
  "academy", "institute", "preschool", "playschool", "boutique", "store", "shop", "showroom", "jeweller", "jeweler", "optician", "florist",
  "real estate", "property", "builder", "contractor", "plumber", "electrician", "interior", "architect", "photographer", "studio",
  "car dealer", "garage", "workshop", "travel agent", "travel agency", "event", "wedding", "decorator", "laundry", "pet", "vet",
  "chartered accountant", "ca firm", "lawyer", "advocate", "law firm", "manufacturer", "factory", "wholesaler", "distributor", "supplier",
];

/**
 * Which source suits a target. Local when a city or region is named AND the kind of business is one people find on a map;
 * otherwise web research. Only a suggestion: the person chooses, and can switch.
 */
export function suggestDiscoveryMode(t: { industry?: string | null; locations?: string[] | null }): DiscoveryMode {
  const kind = ` ${String(t.industry ?? "").toLowerCase()} `;
  const hasPlace = (t.locations ?? []).some((l) => String(l).trim().length >= 2);
  return hasPlace && LOCAL_KINDS.some((k) => kind.includes(k)) ? "local" : "web";
}

export const WEBSITE_FILTERS = ["any", "with", "without"] as const;
export type WebsiteFilter = (typeof WEBSITE_FILTERS)[number];

/** What a local search asks for: all of it typed or chosen by the person. */
export const localSearchSchema = z.object({
  category: z.string().trim().min(2, "Say what kind of business, for example \"dentists\".").max(80),
  city: z.string().trim().min(2, "Name the city or area, for example \"Siliguri\".").max(60),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default("IN"),
  website: z.enum(WEBSITE_FILTERS).default("any"),
  max: z.coerce.number().int().min(1).max(20).default(10),
});
export type LocalSearchInput = z.infer<typeof localSearchSchema>;

/** The text query sent to the provider: the kind of business and the place, as the person wrote them. */
export const localQuery = (i: Pick<LocalSearchInput, "category" | "city">) => `${i.category} in ${i.city}`;

/** A Google Maps link from a place ID alone (the one piece of a listing that may be stored). */
export const mapsUrlFor = (placeId: string) => `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
export const isPlaceId = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{10,300}$/.test(x);

/** One listing, as shown to the person. Transient: built for one response and never written to the database. */
export interface LocalResult {
  placeId: string;
  name: string;
  address: string | null;
  category: string | null;
  /** The website the listing gives, if any (not checked until the person chooses to research it). */
  website: string | null;
  domain: string | null;
  phone: string | null;
  mapsUrl: string;
  /** OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY, when the listing says. */
  status: string | null;
  /** Already in this workspace: as a researched prospect (by website or place ID) or a lead. */
  existing: { prospectId?: number; leadId?: number } | null;
}

/** Applies the person's website choice to listings ("without" = the listing gives no website). */
export function filterByWebsite<T extends { website: string | null }>(rs: T[], f: WebsiteFilter): T[] {
  return f === "with" ? rs.filter((r) => !!r.website) : f === "without" ? rs.filter((r) => !r.website) : rs;
}

/** How a listing's missing website is worded: an observation about the listing, nothing more. */
export const NO_WEBSITE_NOTE = "No website listed on Google Maps. They may still have one; this is only what the listing shows.";

/**
 * Ready-made searches; every one is editable before it runs, and none claims more than it does. A local preset needs a
 * city (the person types theirs).
 */
export interface DiscoveryPreset {
  key: string; label: string; mode: DiscoveryMode;
  /** Local presets: the starting fields. Web presets: the request text. */
  local?: Partial<Pick<LocalSearchInput, "category" | "website" | "max">>;
  request?: string;
  note: string;
}
export const DISCOVERY_PRESETS: readonly DiscoveryPreset[] = [
  { key: "local_no_website", label: "Local businesses without a listed website", mode: "local", local: { category: "dentists", website: "without", max: 10 }, note: "Listings that show no website. They may still have one; check before you reach out." },
  { key: "local_with_website", label: "Local businesses with websites to review", mode: "local", local: { category: "dentists", website: "with", max: 10 }, note: "Listings with a website you can have DealInSec research." },
  { key: "local_small_business", label: "Small businesses in a city", mode: "local", local: { category: "restaurants", website: "any", max: 10 }, note: "Any kind of local business; change the type and the city." },
  { key: "web_industry", label: "International businesses in an industry", mode: "web", request: "10 UK marketing agencies with 5–50 employees", note: "Web research: companies found online, each checked on its own website." },
  { key: "web_redesign", label: "Businesses that may benefit from website work", mode: "web", request: "10 US dental clinics and law firms with 5–50 employees", note: "Each home page is checked for a mobile viewport tag and an old copyright year: hints, not proof they need a new site." },
];
