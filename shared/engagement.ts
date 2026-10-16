/**
 * How a deal is sold (its ENGAGEMENT MODEL) and what work it is (its SERVICE CATEGORY), for small B2B service
 * agencies and consultants. Both are optional and separate from:
 *   - the deal's legacy `dealType` domain (Design, Development, Marketing…), which still drives deliverable lists
 *     and agreement wording. A service maps to one of those domains; with no service the deal is "Custom";
 *   - the deal's STATUS (Pending, Active, Completed) and the leads pipeline stages, which are not touched.
 *
 * Stored as stable ids (deals.engagement_model, deals.service_category) plus the model's own details
 * (deals.engagement_terms, validated here). Labels live only in this file, so they can be reworded freely.
 * An id this build doesn't know (an older or newer value) is never rewritten: it reads as "unrecognised".
 * Pure: shared by the form, the API and the tests.
 */
import { z } from "zod";

/* ── Engagement models (step 1) ──────────────────────────────────────────────────────── */

export const ENGAGEMENT_MODEL_IDS = [
  "retainer", "fixed_price", "hourly", "recurring_service", "milestone", "one_time",
  "commission", "usage_based", "subscription", "consulting", "custom",
] as const;
export type EngagementModel = (typeof ENGAGEMENT_MODEL_IDS)[number];

/** Which set of details a model asks for. */
export type DetailKind = "recurring" | "fixed" | "hourly" | "milestone" | "one_time" | "commission" | "usage" | "consulting" | "custom";

export interface EngagementModelMeta {
  id: EngagementModel;
  label: string;
  description: string;
  example: string;
  kind: DetailKind;
  /** What the deal's single value means for this model (the label on the value field). */
  valueLabel: string;
  valueHint: string;
}

export const ENGAGEMENT_MODELS: readonly EngagementModelMeta[] = [
  { id: "retainer", label: "Monthly Retainer", kind: "recurring", description: "A set fee every month (or quarter, or year) for ongoing work.", example: "Acme — Monthly SEO Retainer", valueLabel: "Contract value", valueHint: "For the first term: the recurring fee × the billing periods in it." },
  { id: "fixed_price", label: "Fixed-Price Project", kind: "fixed", description: "One agreed price for a defined piece of work.", example: "Acme — Website Redesign", valueLabel: "Total contract value", valueHint: "The full agreed price." },
  { id: "hourly", label: "Hourly Engagement", kind: "hourly", description: "Billed by the hour at an agreed rate.", example: "Acme — Hourly PPC Support", valueLabel: "Estimated value", valueHint: "Your best estimate: the rate × the hours you expect." },
  { id: "recurring_service", label: "Recurring Service", kind: "recurring", description: "The same service delivered on a schedule.", example: "Acme — Weekly Social Media Management", valueLabel: "Contract value", valueHint: "For the first term: the recurring fee × the billing periods in it." },
  { id: "milestone", label: "Milestone-Based Project", kind: "milestone", description: "A project paid in stages as each milestone is reached.", example: "Acme — App Build (3 milestones)", valueLabel: "Total project value", valueHint: "The milestones add up to this." },
  { id: "one_time", label: "One-Time Service", kind: "one_time", description: "A single delivery, paid once.", example: "Acme — SEO Audit", valueLabel: "Agreed amount", valueHint: "What the client pays for this service." },
  { id: "commission", label: "Commission-Based Engagement", kind: "commission", description: "Paid as a share of results, such as revenue or sales you generate.", example: "Acme — Appointment Setting on Commission", valueLabel: "Estimated value", valueHint: "Your best estimate of what this will earn you." },
  { id: "usage_based", label: "Usage-Based Service", kind: "usage", description: "Billed by usage: leads, calls, credits, seats or similar.", example: "Acme — Lead Generation (per qualified lead)", valueLabel: "Estimated value", valueHint: "Your best estimate: the unit price × the usage you expect." },
  { id: "subscription", label: "Subscription Service", kind: "recurring", description: "Access to a service or product for a recurring fee.", example: "Acme — Chatbot Subscription", valueLabel: "Contract value", valueHint: "For the first term: the recurring fee × the billing periods in it." },
  { id: "consulting", label: "Consulting Engagement", kind: "consulting", description: "Advice and expertise, billed hourly or at a fixed price.", example: "Acme — Growth Strategy Consulting", valueLabel: "Engagement value", valueHint: "The fixed price, or your estimate for hourly work." },
  { id: "custom", label: "Custom / Other", kind: "custom", description: "Anything else. Describe it in your own words.", example: "Acme — Partnership Pilot", valueLabel: "Deal value", valueHint: "What the deal is worth." },
];
const MODEL_BY_ID = new Map(ENGAGEMENT_MODELS.map((m) => [m.id, m]));
export const isEngagementModel = (v: unknown): v is EngagementModel => typeof v === "string" && MODEL_BY_ID.has(v as EngagementModel);
export const engagementModelMeta = (v: string | null | undefined): EngagementModelMeta | null => (isEngagementModel(v) ? MODEL_BY_ID.get(v)! : null);

/* ── Service categories (step 2, optional) ───────────────────────────────────────────── */

/** The legacy domain a service's deliverables and agreement wording follow (shared/dealTypeTaxonomy.ts). */
type Domain = "Marketing" | "Development" | "Design" | "Writing" | "Video & Photo" | "Consulting" | "Custom";
export interface ServiceMeta { id: string; label: string; domain: Domain; keywords?: string }
export interface ServiceGroup { id: string; label: string; services: ServiceMeta[] }

export const SERVICE_GROUPS: readonly ServiceGroup[] = [
  { id: "marketing_seo", label: "Marketing and SEO", services: [
    { id: "seo_services", label: "SEO Services", domain: "Marketing", keywords: "search engine optimisation optimization rankings" },
    { id: "seo_audit", label: "SEO Audit and Implementation", domain: "Marketing", keywords: "technical seo" },
    { id: "marketing_services", label: "Marketing Services", domain: "Marketing", keywords: "recurring marketing" },
    { id: "content_marketing", label: "Content Marketing", domain: "Marketing", keywords: "blog articles" },
    { id: "email_marketing", label: "Email Marketing", domain: "Marketing", keywords: "newsletter campaigns" },
    { id: "social_media", label: "Social Media Management", domain: "Marketing", keywords: "instagram linkedin facebook smm" },
    { id: "marketing_campaign", label: "Marketing Campaign Project", domain: "Marketing", keywords: "launch" },
    { id: "marketing_strategy", label: "Marketing Strategy and Audit", domain: "Marketing", keywords: "plan" },
  ] },
  { id: "advertising_growth", label: "Advertising and Growth", services: [
    { id: "paid_ads", label: "Paid Advertising / PPC", domain: "Marketing", keywords: "google ads meta ads facebook ads sem ppc" },
    { id: "lead_generation", label: "Lead Generation", domain: "Marketing", keywords: "leads outbound" },
    { id: "sales_development", label: "Sales Development / Appointment Setting", domain: "Marketing", keywords: "sdr appointment setting cold outreach" },
    { id: "cro", label: "Conversion Rate Optimization", domain: "Marketing", keywords: "cro a/b testing landing pages" },
    { id: "growth_marketing", label: "Growth Marketing Consulting", domain: "Consulting", keywords: "growth" },
  ] },
  { id: "web_software", label: "Web and Software Development", services: [
    { id: "web_design_dev", label: "Website Design and Development", domain: "Development", keywords: "website wordpress webflow shopify" },
    { id: "software_dev", label: "Software Development", domain: "Development", keywords: "saas web app" },
    { id: "mobile_app", label: "Mobile App Development", domain: "Development", keywords: "ios android flutter react native" },
    { id: "api_integration", label: "Technical Integration and API Development", domain: "Development", keywords: "integration api" },
    { id: "website_maintenance", label: "Website Maintenance and Support", domain: "Development", keywords: "updates hosting care plan" },
  ] },
  { id: "ai_automation", label: "AI and Automation", services: [
    { id: "ai_automation", label: "AI Automation Implementation", domain: "Development", keywords: "workflow automation zapier make n8n" },
    { id: "ai_chatbot", label: "AI Chatbot Development", domain: "Development", keywords: "chatbot assistant gpt" },
    { id: "crm_automation", label: "CRM and Business Automation", domain: "Development", keywords: "hubspot salesforce crm" },
    { id: "ai_consulting", label: "AI Consulting", domain: "Consulting", keywords: "ai strategy" },
  ] },
  { id: "design_creative", label: "Design and Creative", services: [
    { id: "brand_identity", label: "Brand Identity Design", domain: "Design", keywords: "logo branding" },
    { id: "branding_graphic", label: "Branding and Graphic Design", domain: "Design", keywords: "brand graphics" },
    { id: "ui_ux", label: "UI/UX Design", domain: "Design", keywords: "product design figma" },
    { id: "graphic_design", label: "Graphic Design", domain: "Design", keywords: "graphics" },
    { id: "pitch_deck", label: "Presentation and Pitch Deck Design", domain: "Design", keywords: "slides deck" },
  ] },
  { id: "content_media", label: "Content and Media", services: [
    { id: "video_production", label: "Video Production and Content Creation", domain: "Video & Photo", keywords: "video" },
    { id: "photo_video", label: "Photography and Videography", domain: "Video & Photo", keywords: "photo shoot" },
    { id: "animation", label: "Animation and Motion Design", domain: "Video & Photo", keywords: "motion graphics" },
    { id: "copywriting", label: "Copywriting", domain: "Writing", keywords: "copy website copy ads copy" },
    { id: "content_production", label: "Content Production", domain: "Writing", keywords: "content" },
  ] },
  { id: "consulting_professional", label: "Consulting and Professional Services", services: [
    { id: "business_consulting", label: "Business Consulting", domain: "Consulting", keywords: "management consulting" },
    { id: "sales_consulting", label: "Sales Consulting", domain: "Consulting", keywords: "sales process" },
    { id: "business_strategy", label: "Business Strategy Project", domain: "Consulting", keywords: "strategy" },
    { id: "strategy_session", label: "Strategy Session", domain: "Consulting", keywords: "workshop call" },
    { id: "training", label: "Training and Workshops", domain: "Consulting", keywords: "training workshop" },
    { id: "research_audit", label: "Research and Audit", domain: "Consulting", keywords: "research audit" },
    { id: "implementation_advisory", label: "Implementation and Advisory", domain: "Consulting", keywords: "advisory" },
  ] },
  { id: "it_technical", label: "IT and Technical Services", services: [
    { id: "managed_it", label: "Managed IT Services", domain: "Development", keywords: "it support helpdesk" },
    { id: "technical_consulting", label: "Technical Consulting", domain: "Consulting", keywords: "architecture cto" },
  ] },
  { id: "other", label: "Other", services: [
    { id: "other_service", label: "Other service", domain: "Custom" },
  ] },
];
const SERVICE_BY_ID = new Map(SERVICE_GROUPS.flatMap((g) => g.services.map((s) => [s.id, { ...s, group: g.label }] as const)));
export const isServiceCategory = (v: unknown): v is string => typeof v === "string" && SERVICE_BY_ID.has(v);
export const serviceMeta = (v: string | null | undefined) => (v ? SERVICE_BY_ID.get(v) ?? null : null);

/** The legacy deal-type domain for a new deal: from its service, or "Custom" when none is chosen. */
export function dealTypeForService(service: string | null | undefined): Domain {
  return serviceMeta(service)?.domain ?? "Custom";
}

/* ── The 55 named deal types, as presets of (model, service, billing frequency) ─────── */

export type BillingFrequency = "weekly" | "monthly" | "quarterly" | "annually";
export interface DealPreset { label: string; model: EngagementModel; service?: string; frequency?: BillingFrequency; consultingBilling?: "hourly" | "fixed" }

export const DEAL_PRESETS: readonly DealPreset[] = [
  // A. Retainer and recurring services
  { label: "Monthly Retainer", model: "retainer", frequency: "monthly" },
  { label: "Quarterly Retainer", model: "retainer", frequency: "quarterly" },
  { label: "Annual Retainer", model: "retainer", frequency: "annually" },
  { label: "Recurring Marketing Services", model: "recurring_service", service: "marketing_services", frequency: "monthly" },
  { label: "Recurring SEO Services", model: "recurring_service", service: "seo_services", frequency: "monthly" },
  { label: "Website Maintenance and Support", model: "recurring_service", service: "website_maintenance", frequency: "monthly" },
  { label: "Managed IT Services", model: "recurring_service", service: "managed_it", frequency: "monthly" },
  { label: "Ongoing Consulting", model: "retainer", service: "business_consulting", frequency: "monthly" },
  // B. Fixed-price projects
  { label: "Website Design and Development", model: "fixed_price", service: "web_design_dev" },
  { label: "Software Development", model: "fixed_price", service: "software_dev" },
  { label: "Mobile App Development", model: "fixed_price", service: "mobile_app" },
  { label: "AI Automation Implementation", model: "fixed_price", service: "ai_automation" },
  { label: "AI Chatbot Development", model: "fixed_price", service: "ai_chatbot" },
  { label: "CRM and Business Automation", model: "fixed_price", service: "crm_automation" },
  { label: "Marketing Campaign Project", model: "fixed_price", service: "marketing_campaign" },
  { label: "SEO Audit and Implementation", model: "fixed_price", service: "seo_audit" },
  { label: "Branding and Graphic Design", model: "fixed_price", service: "branding_graphic" },
  { label: "Video Production and Content Creation", model: "fixed_price", service: "video_production" },
  { label: "Business Strategy Project", model: "fixed_price", service: "business_strategy" },
  { label: "Technical Integration and API Development", model: "fixed_price", service: "api_integration" },
  // C. Marketing and growth services
  { label: "SEO Services", model: "retainer", service: "seo_services", frequency: "monthly" },
  { label: "Paid Advertising / PPC", model: "retainer", service: "paid_ads", frequency: "monthly" },
  { label: "Social Media Management", model: "retainer", service: "social_media", frequency: "monthly" },
  { label: "Content Marketing", model: "retainer", service: "content_marketing", frequency: "monthly" },
  { label: "Email Marketing", model: "retainer", service: "email_marketing", frequency: "monthly" },
  { label: "Lead Generation", model: "usage_based", service: "lead_generation", frequency: "monthly" },
  { label: "Sales Development / Appointment Setting", model: "retainer", service: "sales_development", frequency: "monthly" },
  { label: "Conversion Rate Optimization", model: "fixed_price", service: "cro" },
  { label: "Growth Marketing Consulting", model: "consulting", service: "growth_marketing", consultingBilling: "fixed" },
  { label: "Marketing Strategy and Audit", model: "one_time", service: "marketing_strategy" },
  // D. Consulting and professional services
  { label: "Hourly Consulting", model: "hourly", service: "business_consulting" },
  { label: "Project-Based Consulting", model: "consulting", service: "business_consulting", consultingBilling: "fixed" },
  { label: "Business Consulting", model: "consulting", service: "business_consulting", consultingBilling: "fixed" },
  { label: "Sales Consulting", model: "consulting", service: "sales_consulting", consultingBilling: "fixed" },
  { label: "Technical Consulting", model: "consulting", service: "technical_consulting", consultingBilling: "hourly" },
  { label: "AI Consulting", model: "consulting", service: "ai_consulting", consultingBilling: "fixed" },
  { label: "Training and Workshops", model: "one_time", service: "training" },
  { label: "Strategy Session", model: "one_time", service: "strategy_session" },
  { label: "Research and Audit", model: "one_time", service: "research_audit" },
  { label: "Implementation and Advisory", model: "consulting", service: "implementation_advisory", consultingBilling: "fixed" },
  // E. Creative and specialist services
  { label: "Brand Identity Design", model: "fixed_price", service: "brand_identity" },
  { label: "UI/UX Design", model: "fixed_price", service: "ui_ux" },
  { label: "Graphic Design", model: "fixed_price", service: "graphic_design" },
  { label: "Copywriting", model: "fixed_price", service: "copywriting" },
  { label: "Photography and Videography", model: "one_time", service: "photo_video" },
  { label: "Animation and Motion Design", model: "fixed_price", service: "animation" },
  { label: "Presentation and Pitch Deck Design", model: "fixed_price", service: "pitch_deck" },
  { label: "Content Production", model: "recurring_service", service: "content_production", frequency: "monthly" },
  // F. Commercial and other
  { label: "One-Time Service", model: "one_time" },
  { label: "Milestone-Based Project", model: "milestone" },
  { label: "Hourly Engagement", model: "hourly" },
  { label: "Commission-Based Engagement", model: "commission" },
  { label: "Usage-Based Service", model: "usage_based", frequency: "monthly" },
  { label: "Subscription Service", model: "subscription", frequency: "monthly" },
  { label: "Custom / Other", model: "custom" },
];

/** Presets and services matching a search, best first (word starts beat substrings). Empty query: nothing. */
export function searchPresets(query: string, limit = 8): DealPreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const scored = DEAL_PRESETS.map((p) => {
    const hay = `${p.label} ${engagementModelMeta(p.model)?.label ?? ""} ${serviceMeta(p.service)?.keywords ?? ""} ${p.frequency ?? ""}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) return null;
    const score = (p.label.toLowerCase().startsWith(q) ? 3 : 0) + (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(p.label.toLowerCase()) ? 2 : 0) + 1 / (p.label.length + 1);
    return { p, score };
  }).filter((x): x is { p: DealPreset; score: number } => !!x);
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.p);
}

/* ── The model's details (deals.engagement_terms) ────────────────────────────────────── */

export const BILLING_FREQUENCIES: readonly { id: BillingFrequency; label: string; per: string; months: number }[] = [
  { id: "weekly", label: "Weekly", per: "week", months: 12 / 52 },
  { id: "monthly", label: "Monthly", per: "month", months: 1 },
  { id: "quarterly", label: "Quarterly", per: "quarter", months: 3 },
  { id: "annually", label: "Annually", per: "year", months: 12 },
];

const minor = z.number().int().min(0).max(1_000_000_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const shortText = (n: number) => z.string().trim().max(n);

export const engagementTermsSchema = z.object({
  billingFrequency: z.enum(["weekly", "monthly", "quarterly", "annually"]).optional(),
  recurringAmountMinor: minor.optional(),
  renewalDate: isoDate.optional(),
  hourlyRateMinor: minor.optional(),
  estimatedHours: z.number().positive().max(100_000).optional(),
  milestones: z.array(z.object({ title: shortText(120).min(1, "Name each milestone"), amountMinor: minor, dueDate: isoDate.optional() })).max(20).optional(),
  paymentDueDate: isoDate.optional(),
  commissionKind: z.enum(["percent", "fixed"]).optional(),
  commissionPercent: z.number().positive().max(100).optional(),
  commissionAmountMinor: minor.optional(),
  calculationBasis: shortText(200).optional(),
  paymentTrigger: shortText(200).optional(),
  unitLabel: shortText(40).optional(),
  unitPriceMinor: minor.optional(),
  estimatedUsage: z.number().positive().max(10_000_000).optional(),
  consultingBilling: z.enum(["hourly", "fixed"]).optional(),
  scope: shortText(1000).optional(),
  expectedCloseDate: isoDate.optional(),
}).strict();
export type EngagementTerms = z.infer<typeof engagementTermsSchema>;

/** The fields each kind keeps; anything else is dropped (switching models never leaves stale details behind). */
const KEEP: Record<DetailKind, (keyof EngagementTerms)[]> = {
  recurring: ["billingFrequency", "recurringAmountMinor", "renewalDate"],
  fixed: ["milestones"],
  hourly: ["hourlyRateMinor", "estimatedHours"],
  milestone: ["milestones"],
  one_time: ["paymentDueDate"],
  commission: ["commissionKind", "commissionPercent", "commissionAmountMinor", "calculationBasis", "paymentTrigger"],
  usage: ["unitLabel", "unitPriceMinor", "billingFrequency", "estimatedUsage"],
  consulting: ["consultingBilling", "hourlyRateMinor", "estimatedHours", "scope"],
  custom: ["scope", "expectedCloseDate"],
};

export type EngagementInput = { engagementModel?: unknown; serviceCategory?: unknown; engagementTerms?: unknown; dealAmountMinor?: number | null };
export type EngagementResult =
  | { ok: true; engagementModel: EngagementModel | null; serviceCategory: string | null; engagementTerms: EngagementTerms | null }
  | { ok: false; field: string; message: string };

/**
 * Validates a deal's engagement model, service and details together, and returns them normalised (blank details
 * dropped, details of other models dropped). No model means no details. `dealAmountMinor` is the deal's value, for
 * the rules that compare against it (milestones). Used by the API on create and edit, and by the form.
 */
export function validateEngagement(input: EngagementInput): EngagementResult {
  const fail = (field: string, message: string): EngagementResult => ({ ok: false, field, message });
  const model = input.engagementModel ?? null;
  const service = input.serviceCategory ?? null;
  if (model !== null && !isEngagementModel(model)) return fail("engagementModel", "Choose one of the engagement models.");
  if (service !== null && service !== "" && !isServiceCategory(service)) return fail("serviceCategory", "Choose one of the services, or leave it empty.");
  const svc = service === "" ? null : (service as string | null);
  if (model === null) return { ok: true, engagementModel: null, serviceCategory: svc, engagementTerms: null };

  const parsed = engagementTermsSchema.safeParse(input.engagementTerms ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(String(issue?.path?.[0] ?? "engagementTerms"), issue?.message ?? "Check the engagement details.");
  }
  const kind = MODEL_BY_ID.get(model)!.kind;
  const t: EngagementTerms = {};
  for (const k of KEEP[kind]) {
    const v = parsed.data[k];
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    (t as Record<string, unknown>)[k] = v;
  }
  const value = input.dealAmountMinor ?? null;
  switch (kind) {
    case "recurring":
      if (!t.billingFrequency) return fail("billingFrequency", "Choose how often it's billed.");
      if (!t.recurringAmountMinor) return fail("recurringAmountMinor", "Enter the recurring amount.");
      break;
    case "hourly":
      if (!t.hourlyRateMinor) return fail("hourlyRateMinor", "Enter the hourly rate.");
      break;
    case "milestone": {
      if (!t.milestones?.length) return fail("milestones", "Add at least one milestone.");
      const sum = t.milestones.reduce((n, m) => n + m.amountMinor, 0);
      if (value !== null && sum !== value) return fail("milestones", "The milestones must add up to the total project value.");
      break;
    }
    case "fixed":
      if (t.milestones?.length && value !== null && t.milestones.reduce((n, m) => n + m.amountMinor, 0) > value) return fail("milestones", "The milestones add up to more than the total contract value.");
      break;
    case "commission":
      if (!t.commissionKind) return fail("commissionKind", "Choose a percentage or a fixed amount.");
      if (t.commissionKind === "percent" && !t.commissionPercent) return fail("commissionPercent", "Enter the commission rate.");
      if (t.commissionKind === "fixed" && !t.commissionAmountMinor) return fail("commissionAmountMinor", "Enter the commission amount.");
      if (t.commissionKind === "percent") delete t.commissionAmountMinor; else delete t.commissionPercent;
      if (!t.calculationBasis) return fail("calculationBasis", "Say what the commission is calculated on.");
      break;
    case "usage":
      if (!t.unitLabel) return fail("unitLabel", "Name the unit you bill by (for example, qualified lead).");
      if (!t.unitPriceMinor) return fail("unitPriceMinor", "Enter the price per unit.");
      if (!t.billingFrequency) return fail("billingFrequency", "Choose how often it's billed.");
      break;
    case "consulting":
      if (!t.consultingBilling) return fail("consultingBilling", "Choose hourly or fixed-price billing.");
      if (t.consultingBilling === "hourly" && !t.hourlyRateMinor) return fail("hourlyRateMinor", "Enter the hourly rate.");
      if (t.consultingBilling === "fixed") { delete t.hourlyRateMinor; delete t.estimatedHours; }
      break;
    default:
      break;
  }
  return { ok: true, engagementModel: model, serviceCategory: svc, engagementTerms: Object.keys(t).length ? t : null };
}

/* ── Helpers for the form and the deal's display ─────────────────────────────────────── */

/** Billing periods between two dates (whole periods, at least one), for the suggested contract value. */
export function periodsBetween(start: string, end: string, freq: BillingFrequency): number | null {
  const a = new Date(`${start}T00:00:00Z`), b = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return null;
  if (freq === "weekly") return Math.max(1, Math.ceil(((b.getTime() - a.getTime()) / 86_400_000 + 1) / 7));
  // Inclusive term: 15 Jan → 14 Feb is one month; 1 Jan → 31 Mar is three; a part period counts as one.
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() >= a.getUTCDate() ? 1 : 0);
  const per = freq === "monthly" ? 1 : freq === "quarterly" ? 3 : 12;
  return Math.max(1, Math.ceil(months / per));
}

/** A value the deal's details imply, offered to the person (never applied silently). Null when nothing is implied. */
export function suggestedValueMinor(model: string | null | undefined, t: EngagementTerms | null | undefined, dates: { start?: string; end?: string } = {}): number | null {
  const kind = engagementModelMeta(model)?.kind;
  if (!kind || !t) return null;
  if (kind === "recurring" && t.recurringAmountMinor && t.billingFrequency) {
    const n = dates.start && dates.end ? periodsBetween(dates.start, dates.end, t.billingFrequency) : null;
    return n ? t.recurringAmountMinor * n : null;
  }
  if ((kind === "hourly" || (kind === "consulting" && t.consultingBilling === "hourly")) && t.hourlyRateMinor && t.estimatedHours) return Math.round(t.hourlyRateMinor * t.estimatedHours);
  if (kind === "milestone" && t.milestones?.length) return t.milestones.reduce((n, m) => n + m.amountMinor, 0);
  if (kind === "usage" && t.unitPriceMinor && t.estimatedUsage) return Math.round(t.unitPriceMinor * t.estimatedUsage);
  return null;
}

/** "Quarterly retainer", "Hourly engagement"…: the model as this deal uses it. Unknown ids read as such, never guessed. */
export function engagementLabel(model: string | null | undefined, t?: EngagementTerms | null): string | null {
  if (!model) return null;
  const meta = engagementModelMeta(model);
  if (!meta) return "Unrecognised engagement model";
  if (meta.id === "retainer" && t?.billingFrequency && t.billingFrequency !== "monthly") {
    return `${BILLING_FREQUENCIES.find((f) => f.id === t.billingFrequency)!.label} Retainer`;
  }
  return meta.label;
}

export function serviceLabel(service: string | null | undefined): string | null {
  if (!service) return null;
  return serviceMeta(service)?.label ?? "Unrecognised service";
}

/** "Acme — Monthly SEO Retainer": a suggested deal name, only ever offered when the name is still empty. */
export function suggestDealTitle(client: string, model: string | null | undefined, service: string | null | undefined, t?: EngagementTerms | null): string {
  const c = client.trim();
  const svc = serviceMeta(service)?.label.replace(/ Services?$/, "") ?? null;
  const m = engagementModelMeta(model);
  let what: string;
  if (m?.kind === "recurring" && m.id === "retainer") {
    const f = BILLING_FREQUENCIES.find((x) => x.id === (t?.billingFrequency ?? "monthly"))!.label;
    what = svc ? `${f} ${svc} Retainer` : `${f} Retainer`;
  } else if (svc) what = svc;
  else what = m && m.id !== "custom" ? m.label : "";
  return [c, what].filter(Boolean).join(" — ").slice(0, 200);
}
