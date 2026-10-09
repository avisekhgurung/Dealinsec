# AI Outbound: prospect discovery and intelligence engine

The engine answers four questions about a batch of companies: who to contact, why, who exactly, and what to say. Every answer it gives is backed by evidence, and it says what it doesn't know. This document covers the audit, what is reused, what is new, and how it fails, stays safe, controls cost and rolls out.

## 1. What the audit found

| Area | Exists today | Used how |
|---|---|---|
| Search | `DiscoveryProvider` interface with LangSearch (free) and Brave (paid) adapters (`server/discovery/*`). Pure rules in `shared/discovery.ts`: `sanitizeQuery`, `registrableDomain`, `NOT_A_COMPANY_SITE`, `looksLikeCompanyPage`, `cleanName`, `nameResemblesDomain`, `verifyPicks` | **Reused** as the search adapter type. Tavily and Serper are added as two more adapters. Normalisation and the junk filter are built on these rules, not next to them |
| Safe fetching | `validatePublicUrl` and `fetchPublicPage` (`server/knowledge/net-guard.ts`): https only, DNS pinned, private addresses blocked, every redirect re-checked, 3 MB / 15 s limits. `extractHtml` and `extractLinks` | **Reused** for every page the engine reads. XML is allowed only when the caller asks for it (sitemaps) |
| Evidence | `quoteInPage`, `normalizeFindings`, `injectionLike`, `pickLinks`, `ROLE_LOCALS` (`shared/research.ts`) | **Reused**. A finding is kept only if its exact words are on the page it cites |
| Fit | `assessFit` (`shared/fit.ts`): a rule-based verdict | **Reused**. Employee-range and target-market checks add to its signals, and the verdict rule is shared, not copied |
| Score | `scoreLead(fit, lead, claims)` (`shared/lead-score.ts`): deterministic, scores out of 100, unknown parts earn 0, with a confidence band | **Reused unchanged**. Prospect findings are mapped to its claim shape, so a prospect and a lead are scored by the same function |
| LLM | `tracedChat`, `modelFor(task)`, `assertWithinCap`, the `llm_calls` table (which already has `run_id`) | **Reused** as the LLM gateway. New tasks: `icp`, `enrich`, `signals`, `angle` |
| CRM | `prepareNewLead`, `createLead` (deduplicated by organisation and domain), `addClaim`, `leads_org_domain_uniq` | **Reused**. "Add to Leads" is the only way a prospect becomes a lead |
| Agent | Tool registry, risk classes, approvals, untrusted fencing | **Reused**. New tools join the same registry and policy |
| Outreach | `draftOutreach` and `shared/outreach-check.ts` | **Reused**. The draft can take a prospect's outreach angle |
| Conventions | `Result<T>`, `readGate` / `writeGate`, `tablesReadyCheck` returning 503 `*_NOT_SETUP`, additive `script/migrate-*.ts` run by hand, UTC timestamps written by the app | Followed |

Gaps the audit found, and how this work handles them:
- **No job queue.** Background work is a single `setImmediate`. A durable, database-backed workflow is added (section 4).
- **Search caps are invisible outside the agent.** They count the agent's own audit rows. A new `provider_calls` table records every non-LLM provider call, and allowances are counted from it.
- **The existing model call that picks results is not traced** (`server/discovery/pick.ts`). The new engine uses only `tracedChat`. `pick.ts` is left as it is.
- **Sitemaps were refused**, because XML is not an allowed content type. XML is now allowed as an opt-in, for sitemaps only.
- **Two domain rules.** `normalizeDomain` keeps the full host, while discovery uses `registrableDomain`. Prospects are keyed by registrable domain and become leads with `website = https://<registrable>`, so the two dedupe rules agree.

## 2. Domain model

**A search result is not a lead.**

```
search result → candidate → verified → enriched → qualified → ready   (or rejected, with a reason)
                                                                  └→ Add to Leads (a controlled mutation)
```

| Table (new, additive) | Holds |
|---|---|
| `prospect_runs` | One discovery run, which is also its durable job. Stores the request, the structured ICP, quantity, status and stage, funnel counters, the budget used, cost, lease and attempts, and an idempotency key |
| `prospects` | One company per organisation and canonical domain. Stores the name, website, status or reject reason, provenance, a structured company profile (each field with its source), fit and score snapshots, the outreach angle, content hash and research time (the cache), and `lead_id` once added |
| `prospect_run_items` | Links a run to its prospects: rank, stage reached, attempts and error. Reruns reuse companies, and each run shows its own list |
| `prospect_findings` | Evidence-first findings. Kind (fact, signal, decision_maker, opportunity), type, value, status (confirmed / inferred / unknown / conflicting), source URL and type, exact quote, content hash, retrieved and observed dates, confidence, supporting finding ids, meta |
| `provider_calls` | Usage of non-LLM providers: provider, operation, run, ok, latency, estimated cost |

**Why not `lead_claims`.** A claim needs a lead, and a prospect is not one yet. On Add to Leads, the prospect's findings are copied once into `lead_claims` through `addClaim`, with their evidence. From then on the lead's claims are the authority. Nothing is stored twice while it is live.

## 3. Pipeline: cheap steps first, expensive ones last

1. **Parse the ICP** (LLM task `icp`, with a deterministic fallback). The request becomes a validated object: industry, keywords, countries, employee range, target market, roles, exclusions, and quantity (at most 50). It is merged with the saved ideal client. The person confirms or edits it before anything is spent.
2. **Search strategies.** Deterministic templates plus up to 4 phrasings proposed by the model, at most 8 queries. Every query passes `sanitizeQuery`.
3. **Search** through the search adapter(s), with a cap per run and a cap per day.
4. **Normalise, deduplicate, drop junk (no network).** URLs are made canonical (lowercase host, `www`, tracking parameters, fragments and trailing slashes removed). Each candidate is reduced to its registrable domain. Directories, social sites, job boards, news, government and education sites, and files are rejected, each with a reason. Duplicates are dropped within the run, against earlier prospects and against existing leads. Every source is kept as provenance.
5. **Pre-rank (no network).** Title and snippet are matched against the ICP keywords. Only the top 3 × quantity (at most 120) go on.
6. **Verify the site.** The home page is fetched through net-guard. It must be reachable, HTML, on the same site after redirects, and have a business identity: the name in the title or heading, or a domain match. It must have enough text and not be a parked page. A content hash is stored. At most 4 fetches run at once, one per domain.
7. **Enrich** (task `enrich`, one call over the home page plus an about or services page). Proposes country, location, employee range, industry, services and target customers, each with an exact quote. The validator checks the quotes. A `CompanyEnrichmentProvider` (Apollo) adds structured fields when configured, labelled as coming from the provider. Then the **fit gate**: `excluded` or `weak` is rejected before any deep research is spent.
8. **Research** (task `signals`, for top candidates only, about 1.5 × quantity). Reads up to 4 same-site pages: careers, news or blog, case studies, team (and the sitemap when present). One call proposes:
   - buying signals, typed HIRING, NEW_SERVICE, EXPANSION, NEW_LOCATION, NEW_LEADERSHIP, FUNDING, NEW_CASE_STUDY, TECH_CHANGE, CONTENT_ACTIVITY, GROWTH_SIGNAL, PARTNERSHIP or OTHER, each with a quote and a date when stated;
   - decision makers, as a name and role stated on the company's own pages;
   - pain points;
   - opportunities, pointing to the findings that support them.

   The validator keeps a finding only if its quote is on the cited page. Dates are parsed from the quote or the page, and freshness is computed by a pure function: up to 30 days is strong, up to 90 medium, up to 365 weak, older is stale, and an undated signal has unknown recency. An opportunity survives only if every finding it points to survived. Opportunities and judgments are always `inferred`.
9. **Decision makers.** Ranked by the ICP's target roles; Founder is not assumed. A `ContactEnrichmentProvider` (Hunter) adds an email and the provider's own verification status when configured. An email is never guessed and never set on the lead automatically.
10. **Score** with `scoreLead`, after mapping findings to the claim shape. A fresh, confirmed signal also counts as inferred timing. A stale signal does not score. **Ready** means: verified, fit not excluded or weak, a confirmed signal or need, a way to make contact, and not marked do-not-contact.
11. **Outreach angle** (task `angle`, on demand). Its only input is the structured, fenced findings. It produces problem, evidence ids, opportunity, positioning, target person, reason and confidence. It is validated: the evidence ids must belong to the prospect, and the text must pass the outreach-check rules. `draftOutreach` uses it after the prospect is added to Leads.

## 4. Durable workflow

`prospect_runs` is the job table, and `server/workflow/` holds a small generic runner:
- **Atomic claim.** One `UPDATE ... SET lease_until = now + 90 s, attempts = attempts + 1 WHERE id = (SELECT ... WHERE status = 'running' AND (lease_until IS NULL OR lease_until < now) ... FOR UPDATE SKIP LOCKED) RETURNING`. Only one worker anywhere can hold a run. Times are sent as UTC text (the columns have no time zone, and a raw `Date` is written in the process's local zone).
- **Ownership (fence).** The claim number the claim returns (`attempts`) travels with the run as `fence`, kept apart from the row so a refreshed row can't adopt a newer holder's number. Every write to the run (`updateRun`, `setLease`, `finishRun`) must still match it *and* the run must still be `running`: after a takeover or a cancel the old worker's writes do nothing and it stops with `LeaseLost`.
- **Lease renewal.** While a step works, the lease is renewed every 30 s. A renewal that finds the run taken over stops the work at the next slice (the slice in flight finishes; per-item idempotency keeps its results from being paid for twice). A renewal that merely errors is not a loss.
- **Parking, not polling.** When everything left is waiting on a retry back-off, the step returns `{ wait }` (the earliest due time, 10-60 s ahead) and the run is *parked*: its lease is held until then, so nothing claims it and the database sees no queries at all while it waits. One timer wakes the runner at that time, and when the loop goes idle a single `min(lease_until)` query schedules the next wake, so a parked run resumes after a restart with no request. Each re-claim counts against `MAX_CLAIMS` (500).
- **One-statement finish.** `finishRun` sets stage, status, counters, cost, error, finish time and clears the lease together, so a crash can't leave a finished-looking run that still says `running`. A row left that way by older code is finished again on its next claim, with the outcome it already had.
- **Bounded steps.** Each step processes a small slice of prospects. Each prospect's results and its next stage are written in one transaction, so a crash never leaves half a write or a duplicate.
- **Retries.** Provider and timeout errors are retried with a backoff, up to 3 attempts per item. After that the item fails, with a code, and the run carries on.
- **Resume.** A crash or a sleeping instance leaves an expired lease, and the next tick continues from the last checkpoint. Ticks come from an in-process loop that runs only while there is work, a check at boot, and any request to the outbound API. The GitHub keep-warm ping keeps Render awake.
- **Idempotent runs.** Starting the same ICP while a run with that ICP is active returns the existing run, enforced by a unique partial index. Companies seen before are reused, and their research is cached for 14 days.

The step interface is a workflow plus idempotent activities, so the same steps can move onto Temporal later without changing the domain code.

## 5. Provider abstractions

| Interface | Adapters | Default |
|---|---|---|
| Search (`DiscoveryProvider`) | LangSearch, Brave (existing); Tavily, Serper (new) | The configured discovery provider. `OUTBOUND_SEARCH_PROVIDERS` can name several |
| `PageReader` | net-guard + readability (built in); Firecrawl (only for URLs `validatePublicUrl` accepts) | Built in. Playwright is not installed; the interface leaves room for it |
| `CompanyEnrichmentProvider` | Apollo organisation enrichment | Off until `APOLLO_API_KEY` is set |
| `ContactEnrichmentProvider` | Hunter domain search | Off until `HUNTER_API_KEY` is set |
| LLM | `tracedChat` with task routing (`modelFor`) | DeepSeek Flash. Override per task with `SALES_<TASK>_MODEL` |

Domain code depends only on the interfaces. Every adapter is tested against a fake HTTP service.

## 6. Failure handling

- **Provider down.** Search, enrichment and fetch errors are retried, then recorded per item. One provider down never fails the whole run unless every search failed (`search_unavailable`).
- **Bad or empty model output.** One retry. After that the item gets no findings, and that is recorded rather than guessed.
- **Out of allowance.** The run stops at the current stage with `daily_limit`. What it already found stays.
- **Tables missing.** Every outbound route answers 503 `PROSPECTS_NOT_SETUP`, and the rest of the app is unaffected.

## 7. Security

- **Tenant isolation.** Every query is scoped to the organisation, and a foreign id answers "not found".
- **Safe fetching.** Every fetch goes through net-guard: SSRF protection, DNS pinning, private-IP blocking, redirect re-checks, size and time limits, at most one fetch per domain at a time and at most 6 pages per site.
- **Untrusted data.** Page text, snippets, provider data and company names (which come from search-result titles) are always fenced as data. Findings need exact quotes, and text that reads like an instruction is dropped. A company name quoted inside a tool's message to the model is clipped to one short line without tags.
- **Nothing in the pipeline can call an agent tool.** Every agent tool that spends a daily allowance or writes asks first (`discover_prospects`, `research_prospect`, `find_decision_maker`, `get_outreach_angle`, `add_prospect_to_leads`). The one exception is `parse_icp`: it reads, writes nothing, and makes one capped, cheap model call to explain a request. `discover_prospects` says "not set up" before it builds a card or calls a model when no search is connected.
- **Keys and logs.** Keys stay on the server. Logs and traces hold ids, codes, counts and costs, never prompts, page text or personal data.
- **Contacts.** A provider-sourced person is stored with its source and the provider's verification status, shown, and accepted by the person. No email is ever constructed.

## 8. Cost controls

- **Run budget.** Each run's budget scales with quantity: maximum queries, verifications, enrichments, research calls and LLM calls.
- **Daily allowances per workspace.** Runs, searches, company-data lookups (Apollo), contact lookups and each LLM task are capped. They are counted from `provider_calls` and `llm_calls` and fail closed (a count that can't be made skips the paid call).
- **Cheap filters first.** Rule-based filters run before any LLM call, and the fit gate runs before deep research.
- **Research cache.** A company is not researched again within 14 days unless the person forces it.
- **Visible cost.** Each run shows its estimated cost.

For "Find 30" the target is about 16 searches, about 60 enrichment calls and about 45 research calls, roughly $0.30 on Flash.

## 9. Rollout

1. Run `script/migrate-prospects.ts` on production, by hand. It is additive, safe to run twice, and the feature is off until it has run.
2. Push. "AI Outbound" appears in the top navigation, and the Leads page gets an entry button for mobile.
3. Paid providers switch on by key, with no code change: `TAVILY_API_KEY`, `SERPER_API_KEY`, `FIRECRAWL_API_KEY`, `APOLLO_API_KEY`, `HUNTER_API_KEY`.
4. Watch `llm_calls` and `provider_calls` per run. Raise allowances when that is justified.

Out of scope: automatic sending, inbound replies, WhatsApp, LinkedIn scraping or automation, getting around anti-bot controls, and moving to Python or Temporal.

## 10. As built (what is in the repository)

| Piece | Where |
|---|---|
| Five additive tables | `script/migrate-prospects.ts`, `shared/schema.ts` (`prospect_runs`, `prospects`, `prospect_run_items`, `prospect_findings`, `provider_calls`) |
| ICP: schema, rules-based reading of a sentence, merge with the model's answer, search strategies, prospect fit | `shared/icp.ts` |
| URLs, junk filter, one candidate per company, relevance, site check, signal freshness, date reading, score mapping, readiness, budgets | `shared/prospect.ts` |
| Evidence validators (enrichment facts, signals, people, opportunities, outreach angle) | `shared/prospect-intel.ts` |
| Pipeline steps (search, rank, verify, enrich, research, finalize) | `server/outbound/pipeline.ts` |
| Service (the code the routes and the agent both call) | `server/outbound/service.ts`, `routes.ts` |
| Durable runner (claim, lease, resume) | `server/workflow/runner.ts`, `server/outbound/runner.ts` |
| Providers: pages (built in, Firecrawl), company data (Apollo), contacts (Hunter) | `server/outbound/providers.ts` |
| Search: LangSearch, Brave (existing), Tavily, Serper | `server/discovery/*` |
| Prompts (versioned) | `server/outbound/prompts.ts` |
| Agent tools | `server/agent/tools/outbound.ts` |
| UI | `client/src/pages/outbound.tsx`, `client/src/components/outbound/*` |
| Real-world check | `script/e2e-outbound.mts` |

### Environment variables (all optional)
| Variable | Default | What it does |
|---|---|---|
| `OUTBOUND_DAILY_RUNS` | 5 | Prospect searches per workspace per 24 h |
| `OUTBOUND_DAILY_SEARCHES` | 60 | Search-provider calls per workspace per 24 h |
| `OUTBOUND_DAILY_CONTACT_LOOKUPS` | 30 | Contact-provider lookups per workspace per 24 h |
| `OUTBOUND_DAILY_COMPANY_LOOKUPS` | 100 | Company-data (Apollo) lookups per workspace per 24 h |
| `OUTBOUND_SEARCH_PROVIDERS` | the configured discovery provider | e.g. `tavily,brave`: spread the queries over several |
| `SALES_ICP_MODEL`, `SALES_ENRICH_MODEL`, `SALES_SIGNALS_MODEL`, `SALES_ANGLE_MODEL` | `deepseek-flash` | Model per task |
| `SALES_DAILY_ICP_LIMIT` / `_ENRICH_` / `_SIGNALS_` / `_ANGLE_` | 60 / 400 / 250 / 80 | Model calls per workspace per 24 h, counted from `llm_calls` |
| `TAVILY_API_KEY`, `SERPER_API_KEY`, `FIRECRAWL_API_KEY`, `APOLLO_API_KEY`, `HUNTER_API_KEY` | none | Switch the matching provider on (plus `*_URL` to point at a test service) |
| `PROVIDER_COST_USD_<NAME>` | built-in estimates | Cost per call for the run's cost figure |

### What real data taught us (not what we guessed)
The first real run (real search, real websites, real model) passed every invariant check and still produced poor output. The checks pin down what must never happen; they say nothing about whether the results are good. Reading the 27 results by hand showed:

1. **The top "prospect" was a review directory**, and a central bank was marked outreach-ready. A company with the wrong industry still counted as a "partial" fit because its country matched. Now the kind of company is the core of the ICP: an industry mismatch is a weak fit whatever else matches, and only a company known to be that kind of business goes on to research.
2. **Half the results had nothing to do with the request** (an IP lookup site, a volleyball site, an encyclopedia) and were fetched and read anyway. Now a result must say something about the ICP in its own title and snippet, and appearing under several queries only changes the order, never whether to fetch.
3. **A UK agency was "ready" for a US search**, because the page never said which country. A country-code web address (.uk) is now evidence of the country, shown as such. A plain .com says nothing.
4. **An undated signal made a prospect "outreach-ready".** A why-now needs a date. An undated signal still counts in the score, but is not enough to be ready.
5. **Directories and marketplaces** are caught two ways: more are on the blocklist, and the model is asked what the organization IS (business, directory or marketplace, publication, government or nonprofit, personal site), with a quote. Only a clear non-business answer sets it aside; no answer never rejects.
6. **When the model returned nothing for the request, the rules' reading was overwritten by empty defaults** (country and market came out empty). Found because Flash spent its whole 1,500-token budget thinking. The ICP call now has a 4,000-token budget and one retry, and a missing or empty model answer never overrides what the rules read.
7. **The free search index is the limit on recall.** With LangSearch, a search for "digital marketing agencies for SaaS in the US" returned 25 distinct sites, of which one was a real, relevant company. Precision is now right (24 of 25 were correctly set aside, each with its reason). To find more real companies, connect a better search service: set `BRAVE_SEARCH_API_KEY` or `TAVILY_API_KEY` and, for several at once, `OUTBOUND_SEARCH_PROVIDERS`. No code change is needed.

### Known limits
- **Who to contact** comes only from the company's own website (a name with a role in the same quote) or a connected contact provider (Hunter). Small agencies often have no team page, so many prospects have no named person. That is shown, not papered over, and an email is never constructed.
- **Why now** needs dated evidence on the company's own pages. Many sites date nothing, so "outreach-ready" is deliberately hard to reach.
- **Country** is known only when the page states it or the web address ends in a country code.
- **The run is bounded by Render's one small instance**: about 4–5 minutes for ~25 companies. A sleeping or restarted instance resumes from its checkpoint (the lease expires); it does not lose work.

### Test and evaluation results (9 Oct 2026)

| Check | Result |
|---|---|
| `tsc`, `vitest run`, `npm run build` | clean; 67 files, 1255 tests |
| Mutation checks (break a guard, a test must fail) | all 32 guards caught |
| `script/e2e-outbound.mts` (real search, real sites, real model, local DB) | 47/47 invariants |
| Live agent eval `agent-v4` (14 outbound cases x 3) | 100%, 0 safety failures |
| `agent-v1` (31 x 3), `agent-v3` (17 x 3) | 100%, 100%; 0 safety failures |
| `agent-v2` (45 x 3), second run | 96% pass rate, 99% of assertions, 0 safety failures |

Notes: the first `agent-v2`/`agent-v3` runs dropped to 56%/73% because the model provider timed out ("couldn't reach the AI service", ~21 s); they were re-run. `lead-find-without-names` now reads "quick web search" because a batch request is correctly routed to `discover_prospects` (covered by `agent-v4`). Two reply-wording checks (`knowledge-shown-in-fit-check`, `discovery-not-set-up`) are flaky, not unsafe.

### Reliability pass (9 Oct 2026, after the audit of `ab3f244`)
Fixed, each with a regression test that fails when the fix is removed (16 of 16 deliberate breakages caught):
- a run whose only work was a retry back-off looped against the database at full speed (now parked, zero queries while it waits);
- no lease renewal and unfenced writes (now fenced, renewed, with `LeaseLost`); raw-SQL timestamps now UTC (proved on the local database under `America/Los_Angeles`: the old SQL stored the lease 7 hours off);
- a failed page read was cached for 30 minutes, so retries were no-ops (failures are never cached);
- the run's finish was two statements (now one; half-finished rows heal);
- company enrichment had no daily allowance; contact lookups were recorded at zero cost and ran for set-aside companies;
- `discover_prospects` built an approval card before checking that a search was connected;
- `get_outreach_angle` ran without asking at autonomy 1; company names were unfenced in prompts and quoted raw in tool messages;
- the related-note lookup missed "crypto" for "Cryptocurrency exchange" (the fit verdict itself is unchanged);
- `shared/schema.ts` now declares the `prospect_runs_one_active` index the migration already creates.

Known and left as is: item-level writes are not fenced (a worker that just lost its lease can land the slice already in flight; unique indexes and per-item freshness keep that from duplicating rows or spend); two concurrent "Add to Leads" clicks can leave the second lead without copied evidence; no per-domain fetch mutex (3 items at a time, up to 5 pages each).

### Benchmark-driven changes (10 Oct 2026)
Measured against 72 companies verified from their own websites (`docs/ai-outbound-benchmark-2026-10.md`, `script/outbound-benchmark*.mts`). Each has a test that fails without it.
- **Page reader:** a bounded, labelled block of footer / `address` / `mailto:` / `tel:` / structured-data address text is added to each page (the article extractor drops footers). Location was unknown for 50 of 54 companies before; 24 of 54 after. Quotes are checked against exactly this text.
- **Model budget:** enrich and research ask for 8,000 output tokens; a reasoning model returned nothing at 3,000. An empty reply is a failed call (retried 3 times, then `failed` with a code), never "unclear".
- **Fit:** a country the person named is a requirement (a stated or web-address-evident other country is a weak fit). The ICP prompt asks for the specialist kinds of the same company (up to 8 keywords).
- **Identity check:** accepts the domain without its legal tail (`callboxinc.com` shows "Callbox"), folds accents; titles prefer the segment the domain spells.
- **People:** the model names each person's employer; only a match with the company (name or domain) is kept, so a client quoted in a testimonial is not a decision maker.
- **Freshness labels** say what the bands are: "Last 30 days", "Last 3 months", "Last 12 months".
Tried and not shipped: matching ICP phrases by their words (admitted an IP-lookup site and a market-research report on real search results).

The full benchmark report, the truth set and the raw results name third-party companies and people, so they are kept local (not in this public repository). The reproducible parts are committed: `script/bench/normalize.mts`, `script/outbound-benchmark.mts` (search diagnostics and the real end-to-end run), `script/outbound-benchmark-injected.mts` (every stage after search, on its own) and `script/check-outbound-store.mts` (the lease SQL on a real database). Deploying: `docs/ai-outbound-staging-checklist.md`.
