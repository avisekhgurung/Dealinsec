/**
 * Demand posts from community sources: people publicly asking for the work the person sells. Pure: parsing,
 * filtering and shaping only — the server adapters (server/discovery/hn.ts) do the fetching. No model ever
 * touches a post; what reaches the person is the post's own words, its own date and a link to it.
 *
 * Two shapes come out of a scan (server/outbound/pipeline.ts opportunityScan):
 *   - a post that links a company website → a seeded prospect in the normal pipeline, carrying the post as a
 *     confirmed, dated HIRING signal with hiringKind "outside_help" (shared/opportunity-signals.ts) — the 3A
 *     scoring then treats it as the real buying signal it is;
 *   - a post with no company site → a "direct ask": title + link + date only, listed read-only on the run.
 */
import { isBlockedSite, registrableDomain } from "./discovery";
import { textMatches } from "./fit";
import { classifyHiring } from "./opportunity-signals";

export interface OpportunityPost {
  /** The source adapter's name ("hn"). */
  source: string;
  /** The thread or feed the post came from, for provenance ("Freelancer? Seeking freelancer? (November 2026)"). */
  threadTitle: string;
  /** The post's first line, as a human-readable label. */
  title: string;
  /** A link to the post itself (never to a page we scraped). */
  url: string;
  /** The post's text, tags stripped, capped. */
  text: string;
  /** The platform's own timestamp for the post (ISO), or null. */
  postedAt: string | null;
  /** The first company-looking website the post links, or null (then it can only be a direct ask). */
  companyUrl: string | null;
}

/** What a run keeps for a post with no company site: the ask itself, nothing invented. */
export interface DirectAsk { source: string; title: string; url: string; date: string | null }

export const MAX_DIRECT_ASKS = 20;
/** The most prospects one scan may seed into a run (the regular search budget is untouched). */
export const MAX_OPPORTUNITY_PROSPECTS = 8;

/* ── HN (Algolia API) parsing ───────────────────────────────────────────── */

const DAY = 86_400_000;
/** A monthly thread older than this is last month's: its asks are gone stale. */
const THREAD_MAX_AGE_DAYS = 45;

export interface HnThread { id: string; title: string; kind: "seekers" | "hiring" }

/**
 * The current monthly threads among the `whoishiring` account's stories: the "Freelancer? Seeking freelancer?"
 * thread (people asking to hire freelancers) and "Who is hiring?" (companies hiring — only contract/freelance
 * entries are kept from it, by wording). Recognised by title, by age; anything else is ignored.
 */
export function pickWhoishiringThreads(hits: unknown, now: Date): HnThread[] {
  const rows = Array.isArray((hits as any)?.hits) ? ((hits as any).hits as any[]) : [];
  const out: HnThread[] = [];
  for (const h of rows) {
    const title = String(h?.title ?? ""), id = String(h?.objectID ?? ""), at = new Date(String(h?.created_at ?? ""));
    if (!id || !Number.isFinite(at.getTime()) || now.getTime() - at.getTime() > THREAD_MAX_AGE_DAYS * DAY) continue;
    const kind: HnThread["kind"] | null = /freelancer/i.test(title) && /seeking/i.test(title) ? "seekers" : /who is hiring\?/i.test(title) ? "hiring" : null;
    if (kind && !out.some((t) => t.kind === kind)) out.push({ id, title: title.slice(0, 120), kind });
  }
  return out;
}

/** Comment HTML to plain text: paragraph breaks kept, tags dropped, the usual entities decoded. Good enough to read and match; never shown as HTML. */
export function stripHtml(html: string): string {
  return String(html ?? "")
    .replace(/<p>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#x2F;/g, "/").replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

const SEEKING_FREELANCER = /^\s*seeking\s+freelancers?\b/i;
const SEEKING_WORK = /^\s*seeking\s+work\b/i;

/**
 * A post's human-readable label: its first line that actually says something — a leading template field
 * ("Location: Andalucía, Spain") is skipped when a descriptive line follows (a "SEEKING …" line always counts
 * as descriptive). Found live: a real ask was labelled by its location field.
 */
export function titleOf(text: string): string {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const pick = lines.find((l) => /^seeking\b/i.test(l) || l.length > 60 || !/^[A-Za-z /()&-]{2,24}:\s*\S/.test(l)) ?? lines[0] ?? "";
  return pick.replace(/\s+/g, " ").slice(0, 120);
}

/** Hosts that are never the asker's own business site; a link to one leaves the post a direct ask. */
const NOT_A_COMPANY_LINK = /^(news\.ycombinator\.com|ycombinator\.com|hn\.algolia\.com)$/i;

/**
 * Multi-tenant hosting suffixes. A link to one is somebody's page ON the platform, and the pipeline keys prospects
 * by registrable domain — seeding it would make "netlify.app" itself the company (found live, 10 Nov 2026: a real
 * ask linking a netlify.app page seeded Netlify). Such a post stays a direct ask, which still shows the person the
 * ask and its link.
 */
const SHARED_HOSTING = new Set([
  "netlify.app", "vercel.app", "github.io", "gitlab.io", "pages.dev", "web.app", "firebaseapp.com", "herokuapp.com",
  "onrender.com", "fly.dev", "surge.sh", "webflow.io", "wixsite.com", "weebly.com", "wordpress.com", "blogspot.com",
  "notion.site", "carrd.co", "framer.website", "framer.app", "super.site", "bubbleapps.io", "myshopify.com",
  "gumroad.com", "lovable.app", "replit.app", "streamlit.app", "itch.io",
]);

/** The first company-looking website a post links: not HN, not a known platform/profile site, not a page on shared hosting. */
export function siteLinkOf(text: string): string | null {
  for (const m of Array.from(String(text ?? "").matchAll(/https?:\/\/[^\s<>")\]]+/gi))) {
    let u: URL;
    try { u = new URL(m[0].replace(/[.,;:!?]+$/, "")); } catch { continue; }
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const domain = registrableDomain(host);
    if (!domain || NOT_A_COMPANY_LINK.test(host) || isBlockedSite(domain) || SHARED_HOSTING.has(domain)) continue;
    return u.toString();
  }
  return null;
}

/**
 * Algolia comment hits of one thread, as demand posts. The seekers thread keeps only "SEEKING FREELANCER"
 * entries (its convention; "SEEKING WORK" entries are freelancers advertising themselves — the person's
 * competitors, not their clients). The hiring thread keeps only entries whose own wording asks for outside
 * help (classifyHiring): a plain full-time posting is not demand for a freelancer.
 */
export function hnPostsFrom(commentHits: unknown, thread: HnThread): OpportunityPost[] {
  const rows = Array.isArray((commentHits as any)?.hits) ? ((commentHits as any).hits as any[]) : [];
  const out: OpportunityPost[] = [];
  for (const h of rows) {
    const id = String(h?.objectID ?? "");
    // The API entity-encodes even the slashes in links, so everything (the site link too) is read from decoded text.
    const full = stripHtml(String(h?.comment_text ?? ""));
    const text = full.slice(0, 2000);
    if (!id || text.length < 30) continue;
    if (thread.kind === "seekers" ? (!SEEKING_FREELANCER.test(text) || SEEKING_WORK.test(text)) : classifyHiring(text) !== "outside_help") continue;
    const at = new Date(String(h?.created_at ?? ""));
    out.push({
      source: "hn", threadTitle: thread.title,
      title: titleOf(text),
      url: `https://news.ycombinator.com/item?id=${id}`,
      text,
      postedAt: Number.isFinite(at.getTime()) ? at.toISOString() : null,
      companyUrl: siteLinkOf(full),
    });
  }
  return out;
}

/* ── matching posts to the ICP ──────────────────────────────────────────── */

/**
 * The posts worth this run's attention: those that name the person's own services (word match, shared/fit.ts
 * textMatches — the same rule the fit check uses), newest first, capped. No services = no posts: an
 * opportunity scan without an offer to match would just be noise.
 */
export function relevantAsks(posts: OpportunityPost[], icp: { services?: string[] }, max = MAX_DIRECT_ASKS): OpportunityPost[] {
  const services = (icp.services ?? []).filter((s) => s.trim());
  if (!services.length) return [];
  return posts
    .filter((p) => services.some((s) => textMatches(s, p.text)))
    .sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
    .slice(0, max);
}

export const directAskOf = (p: OpportunityPost): DirectAsk => ({ source: p.source, title: p.title, url: p.url, date: p.postedAt });

/* ── Reddit (official Data API) parsing ─────────────────────────────────── */

/** Bodies Reddit shows in place of content that is gone: never kept, never shown. */
const REDDIT_GONE = /^\s*\[(?:removed|deleted)(?: by [^\]]+)?\]\s*$/i;

/**
 * A Reddit search listing (`/search` on oauth.reddit.com), as demand posts. Kept: the post's own title and text, its
 * own timestamp, its subreddit and a link back to it. NOT kept: the author. A username is personal data the person
 * has no use for here — they follow the link to the post, where Reddit shows it under Reddit's own rules — and not
 * holding it means a deleted account leaves nothing behind in our database.
 *
 * Skipped: removed or deleted posts, adult communities, pinned moderator posts, and anything without a permalink.
 * Whether a post is an ASK at all is decided later (shared/social-intent.ts), from its words.
 */
export function redditPostsFrom(listing: unknown): OpportunityPost[] {
  const rows = Array.isArray((listing as any)?.data?.children) ? ((listing as any).data.children as any[]) : [];
  const out: OpportunityPost[] = [];
  for (const row of rows) {
    const d = row?.data;
    if (!d || row?.kind !== "t3") continue;
    const permalink = typeof d.permalink === "string" && d.permalink.startsWith("/r/") ? d.permalink : "";
    const title = String(d.title ?? "").replace(/\s+/g, " ").trim();
    const body = String(d.selftext ?? "");
    if (!permalink || !title || d.over_18 === true || d.stickied === true) continue;
    if (REDDIT_GONE.test(body) || d.removed_by_category || /^\[(?:removed|deleted)/i.test(title)) continue;
    const text = `${title}\n${body}`.trim().slice(0, 2000);
    const created = Number(d.created_utc);
    const at = Number.isFinite(created) && created > 0 ? new Date(created * 1000) : null;
    const sub = String(d.subreddit ?? "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 30);
    out.push({
      source: "reddit", threadTitle: sub ? `r/${sub}` : "Reddit",
      title: title.slice(0, 160),
      url: `https://www.reddit.com${permalink}`,
      text,
      postedAt: at && Number.isFinite(at.getTime()) ? at.toISOString() : null,
      companyUrl: siteLinkOf(body),
    });
  }
  return out;
}

/* ── public web discussions (through a search provider) ─────────────────── */

/**
 * Search results as demand posts — only those on one of the discussion sites that were asked for. A provider that
 * can't restrict a search by site returns whatever it likes, so the restriction is enforced here as well: a blog
 * post or an agency's own sales page that slipped in is not a discussion and is dropped.
 *
 * What a search result gives is a title, a short snippet and a link — never the page, and usually no date. So the
 * post's date is unknown (and the score says so) rather than guessed from the day we happened to find it.
 */
export function discussionPostsFrom(results: { url: string; title: string; snippet?: string }[], domains: readonly string[]): OpportunityPost[] {
  const out: OpportunityPost[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    let u: URL;
    try { u = new URL(r.url); } catch { continue; }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const site = domains.find((d) => host === d || host.endsWith(`.${d}`));
    if (!site) continue;
    const key = `${host}${u.pathname.replace(/\/+$/, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = String(r.title ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    const snippet = String(r.snippet ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    const sub = site === "reddit.com" ? u.pathname.match(/^\/r\/([A-Za-z0-9_]{2,30})\//)?.[1] : null;
    out.push({
      source: "web", threadTitle: sub ? `r/${sub}` : host,
      title, url: u.toString().slice(0, 500),
      text: `${title}\n${snippet}`.trim().slice(0, 1000),
      postedAt: null,
      companyUrl: null,
    });
  }
  return out;
}
