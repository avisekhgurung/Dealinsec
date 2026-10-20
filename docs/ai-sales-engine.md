# AI sales engine: audit, architecture and the first vertical slice

Date: 20 Oct 2026. Everything below was checked in the code, not taken from earlier reports. File references are relative
to the repository root. No production data was read for this document.

## 1. Audit

### Verified and implemented

| Area | What exists | Where |
|---|---|---|
| Stack | React 18 + Vite 5 + wouter + TanStack Query, Tailwind + shadcn; Express API; Drizzle on Postgres; build bundles `dist/index.cjs` and `dist/worker.cjs` | `package.json`, `script/build.ts` |
| Migrations | Manual, additive, idempotent `script/migrate-*.ts`; boot fails closed on missing core columns; feature tables degrade with a 503 | `server/index.ts`, `server/*/ddl.ts` |
| Discovery | Durable run: search → rank → verify identity/domain → enrich + fit gate → research → score → readiness; providers LangSearch, Brave, Tavily, Serper (ordered list), Google Places for local search (listings never stored) | `server/outbound/pipeline.ts`, `server/discovery/*` |
| Page reading | SSRF-safe reader, robots.txt (`RobotsReader`), Firecrawl only as a paid fallback (3 reads/domain/day) | `server/outbound/providers.ts` |
| Evidence | `prospect_findings`: kind, type, value, status (confirmed/inferred/unknown/conflicting), source URL + type, exact quote, observed date, confidence, supporting ids, retrieval time, date metadata | `shared/schema.ts` |
| Validation | A quote must literally be on the page the model read; dates must sit beside their claim; staff must be on the company's own pages; untrusted text fenced, instruction-like text rejected | `shared/research.ts`, `shared/prospect-intel.ts`, `server/agent/untrusted.ts` |
| Lead score | Deterministic 100 points (fit 20, need 25, signal 20, budget 15, contact 10, timing 10) with reasons; readiness classes and timing bands; the model never picks a number | `shared/lead-score.ts`, `shared/prospect.ts` |
| Outreach | Drafts from confirmed facts only, checked by code, approved by the exact text's hash; Gmail send (flag-gated), WhatsApp Cloud API (opt-in, 24 h window, templates, signed webhooks, idempotent), LinkedIn/X drafts only; do-not-contact list enforced at draft, approve and send | `server/sales/outreach.ts`, `server/mail/*`, `server/channels/*` |
| Follow-ups and replies | Email follow-up drafts on business-day gaps with stop rules; Gmail reply sync and WhatsApp inbound (flag-gated); regex reply classes | `server/sales/followups.ts`, `server/mail/reply-*.ts` |
| Jobs | Leased, fenced, checkpointed runs with retries, backoff, cancellation, time limits and idempotency keys; optional dedicated worker | `server/workflow/runner.ts`, `server/ai-league/runtime.ts`, `server/worker.ts` |
| Tenancy | Every store filters by organization; RBAC gates in the service layer; provider tokens sealed with AES-256-GCM | `shared/permissions.ts`, `server/services/leads.ts`, `server/mail/token-crypto.ts` |
| Cost ledger | `llm_calls` (task, model, prompt version, tokens, estimated cost, run, lead) and `provider_calls`; per-task, per-pool, platform and per-workspace ceilings reserved atomically | `server/llm/traced.ts`, `shared/llm-cost.ts` |
| One AI runtime | Agent loop shared by Agent mode and Nibo/Mika/Zee (per-coworker tool allowlists and personas) | `server/agent/loop.ts`, `server/ai-league/chat.ts` |

### Partially implemented

- **Opportunity**: research stores model-proposed opportunities citing findings; the on-demand "angle" (problem, opportunity, positioning, person) cited findings but had **no solution, proof-of-value sample, confirm/disprove test or effort**. *(Filled by this slice.)*
- **Structured output**: hand-written normalizers (not zod) drop bad items with tallied reasons and retry once; there is no repair step beyond dropping.
- **Lead claims** keep less than findings (no observed date, confidence or source type).
- **Costs**: recorded per call, but no report of cost per researched company, per opportunity or per reply. *(Operator script added.)* No cached-token column.
- **Prospect feedback** is stored and shown, but feeds nothing.

### Present but not connected end to end

- Gmail sending, reply sync and WhatsApp exist behind flags; real sending stays off until the founder enables it per organization.
- The dedicated background worker is built; `render.yaml` declares only the web service, so jobs run in the web process until a worker is created in the Render dashboard.

### Missing

- **Historical analysis**: research replaces a batch's earlier findings, and `contentHash` is never compared, so no change over time can be shown. Claims of history are not made anywhere.
- **Funnel from research to revenue**. *(Added by this slice.)*
- Objection handling and reply drafting (replies only change status).
- Demo outcome tracking beyond the lead's stage.

### Unknown, needs runtime verification

- Real-mailbox and WhatsApp end-to-end sends in production (flags and Meta setup are the founder's).
- Provider prices: the app's price table is a configuration, not the providers' current price lists.

## 2. Architecture: current vs. proposed

The brief's pipeline already exists up to the outreach draft. The slice adds the missing middle and the end, inside the
same modules, with **no new table, framework, queue or service**:

```
discovery → identity → evidence → validation → [opportunity plan + opportunity score] → brief → Mika draft → approval → send → reply → [funnel]
                                                 └ new, stored in prospects.angle (jsonb) └ new, read-only over existing tables
```

| Concept | Decision |
|---|---|
| Research runs, evidence, jobs | Reuse `prospect_runs`, `prospect_findings`, the runner |
| Opportunity hypothesis | Reuse `prospects.angle` (jsonb): the angle gains a `plan` |
| Opportunity score | Computed on read from the stored angle and today's findings (pure, reproducible); not stored |
| Research brief | Reuse the assembled `ProspectBrief`; adds `opportunityScore` |
| Outreach drafts | Reuse `lead_messages` / `channel_messages`, approval-by-hash, allowances |
| Outcomes | Reuse lead stages, `outreach_events`, `channel_messages`, `deals` |
| Cost ledger | Reuse `llm_calls` + `provider_calls`; report by script |
| Historical observations | Not built: would need findings to be kept per batch instead of replaced (a schema change; deferred) |

## 3. What this slice adds

1. **Opportunity plan** (`shared/prospect-intel.ts` `normalizePlan`, prompt `angle-v4`): solution, why it could help,
   impact/effort/service match (fixed choices), what would confirm or disprove it, next step, and an optional small
   proof-of-value sample (title, scope, effort "a few hours" or "a day or two", assumptions, exclusions, what the
   company would provide). Checked like the angle (no prices, links or instruction-like text). A bad sample is dropped;
   a bad plan is dropped and the angle kept; an answer without a plan gets one more try.
2. **Opportunity score** (`shared/opportunity-score.ts`, `opp-v1`): see section 4.
3. **Brief UI** (`client/src/components/outbound/opportunity-plan.tsx`): the hypothesis, the cited evidence with page
   links, quotes and dates (confirmed and inferred visibly apart), the plan, the sample, the score with reasons, and its
   limits.
4. **Mika's draft** (`draft-v4`): uses the plan's solution and is told the problem is a guess. The sample is offered
   **only when the person ticks "Offer a small sample"** on the lead (it commits their time); an agent never offers it.
   Drafts still need approval; nothing is sent automatically.
5. **Results** tab in Client Radar (`GET /api/outbound/funnel`): researched → opportunity → lead → drafted → approved →
   sent → replied → meeting → proposal → won, plus won revenue, lost and opted out, for the companies researched in
   30/90/365 days. Counts of companies; organization-scoped SQL.
6. **Operator cost report** (`script/sales-engine-report.mts`): read-only; estimated model and provider cost per
   researched company, per opportunity and per reply, per workspace. Dollars are never shown to workspaces.
7. **Live evaluation harness** (`script/eval-opportunity.mts`): real model calls on companies already researched in the
   local test database (section 8).

## 4. Opportunity scoring rules (opp-v1)

Deterministic: the same evidence and plan always give the same score. The model's only inputs are three fixed choices
(impact, effort, service match), each mapped to points by code and capped by the evidence.

| Part | Max | Rule |
|---|---|---|
| Evidence | 30 | 9 per cited finding confirmed with a page and an exact quote; 2 per inferred one (at most 2); +2 per dated confirmed finding (at most 2); +3 if two or more separate pages agree. **Nothing confirmed caps it at 9.** |
| Fit | 25 | Company fit: strong 15, partial 9, weak 3, excluded 0, unclear 4. Solution vs. what you sell: direct 10, adjacent 5, none 0, unknown 0 (the workspace hasn't said what it sells: set by code, never by the model). |
| Value | 20 | Impact: high 12, medium 8, low 4; +8 if a confirmed business-change signal (hiring, funding, new service, expansion, new location, new leadership, technology change, partnership) backs it. **Capped at 8 without confirmed evidence.** |
| Timing | 15 | Best cited signal: concrete event ≤ 90 days 15, context 7, undated 3, stale or none 0. |
| Feasibility | 10 | Effort: small 6, medium 4, large 1; +4 if a small sample is proposed. |

Confidence is reported separately from value: high with two or more confirmed findings and a date (a strong-timing
event, or two separate pages with at least one dated finding); medium with one confirmed finding; low otherwise.
"Evidence" measures how well the cited findings are confirmed, not proof of the problem: the problem stays a hypothesis
whatever the score. `OPPORTUNITY_WEIGHTS="30,25,20,15,10"`
rescales the parts. These weights are a starting hypothesis; calibrate them against real outcomes (the Results funnel),
not by a model.

## 5. Costs (to verify before expanding providers)

No price is hard-coded by this slice. The angle with plan is one model call per company, on demand (task `angle`, up to
4,000 output tokens, at most two tries), under the existing per-workspace and platform ceilings. Measure with
`script/sales-engine-report.mts`; the figures are estimates from the app's own price table (`shared/llm-cost.ts`,
`server/outbound/providers.ts`), not provider bills. Check current DeepSeek, Tavily and Firecrawl pricing before raising
any ceiling.

## 6. Next phases (each with its acceptance test)

1. **Pilot 20–50 companies in one niche** (e.g. digital marketing agencies, one country): for each, the domain is right,
   each cited source opens and supports its claim, facts and hypotheses are apart, the score is reproducible, Mika's
   draft is specific. Record verdicts with the existing prospect feedback.
2. **Keep findings over time** (versioned batches + content-hash comparison) before any "what changed" claim.
3. **Reply assistant**: suggested answers to replies and objections from verified product facts only, as drafts.
4. **Calibrate** the opportunity weights against the funnel once there are enough outcomes; never train a model before.

## 7. How to run and verify

```bash
npx tsc --noEmit -p .
npx vitest run shared/opportunity-score.test.ts shared/sales-funnel.test.ts shared/prospect-intel.test.ts server/outbound/funnel.test.ts server/agent/eval/outbound.test.ts server/agent/eval/outreach-mvp.test.ts
OUTREACH_PG_TEST_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx vitest run server/outbound/funnel.pg.test.ts
DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/sales-engine-report.mts --days 30
```

In the app: Client Radar → open a researched prospect → "Find the opportunity" (or "New angle and plan") → read the
Opportunity section; add it to Leads → on the lead, tick "Offer a small sample" if you want it, then "Write a message";
Client Radar → Results for the funnel.

## 8. Live evaluation (20 Oct 2026, local test database, real DeepSeek `deepseek-flash`)

Eight real companies already researched from their public pages (digital marketing agencies, India and US), four rounds,
73 model calls, about $0.11 at the app's price table. Each round: an angle with plan per company, the cited evidence
re-fetched, and for companies with a public business email two drafts (sample off, then on), a wrong-hash approval
attempt, and a check that nothing was sent; plus one copy of a company with a planted instruction among its findings.
Results (company names stay in the local result files, not here):

| Check | Result |
|---|---|
| Structured output | 32 of 32 angles with a valid plan; 4 needed the one retry (plan missing on the first answer); 0 failed calls |
| Evidence | Confirmed citations re-fetched: every page opened; 1–2 of 21–24 quotes per round were no longer found (a blog index whose post rotated off, a changed home page, and once the checker's own text extraction). Inferred citations carry no source by design |
| Hypotheses | Every problem is worded as unconfirmed or a question; no claim of lost revenue, failure or certainty |
| Planted instruction ("losing 60% of revenue", a discount, a link) | Never cited, no link, no discount, no loss claim, in all rounds |
| Approval | A wrong text hash was refused every time; drafts stayed drafts; no send was recorded |
| Usage | Every try is its own `llm_calls` row with task, prompt version, tokens and estimated cost |

Defects found and fixed (each with a regression test):

1. **Sample offered without the switch** (3 of 8 drafts with the switch off, rounds 1–2): the prompt rule alone didn't hold. Now a draft that
   offers to make something (`offersToMake`) is refused and retried when no sample was chosen. Round 3 (no offer stated):
   0 of 8 drafts offered anything, switch on or off. Round 4 (offer stated): 0 of 4 with the switch off (2 caught and
   corrected by the retry), 4 of 4 with it on.
2. **Invented offer**: workspaces that never described what they sell got plans "matching what you sell" and a draft saying
   "I'm a writer and editor". Now: no offer → service match `unknown` (0 fit points), no sample, no solution passed to the
   draft, and a draft that describes the sender is refused (`describesSender`).
3. **Internal ids in the text** ("(F12056, F12061)") reached the brief and the draft input: stripped (`stripCitations`).
4. **Overconfident**: two undated findings on two pages scored "high" confidence; high now needs a date.
5. **Sample for a service you don't sell**: dropped when the service match is `none`.
6. **Angle built on a site-markup observation** (an old copyright year): observations no longer reach the angle model.

Observed, not changed: the model's impact judgment is mostly "medium" (it barely separates companies; the evidence and
timing parts do); evidence from blog index pages goes stale within days; the sample switch is per draft and nothing yet
records whether an offered sample led to a meeting.

Rerun: `DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx --env-file=.env script/eval-opportunity.mts --n 8 --out <scratch dir>`
(the guard refuses a non-local database; keep results out of the repository, they name third parties).

## 9. Funnel history and cost measurement

**Stage history.** Every stage change is already written to `lead_events` (`status_changed {from, to}`: the lead
service, sends, Gmail and WhatsApp replies; `converted` for won). The funnel now counts a stage when the lead is in it
or ever moved to it, so a lead lost after a meeting still counts as a meeting. No new table. Leads older than the event
log only count their current stage.

**What the cost report counts:** each model try (retries and failures included), open reservations separately,
research-provider calls by operation, WhatsApp replies as replies. **What it can't:** cached-input discounts (priced as a
cache miss: an upper bound); per-model prices (one table for every DeepSeek model); a provider's own retry inside one call;
the free page reader and robots.txt; WhatsApp conversation charges billed by Meta (recorded at 0); hosting. Window starts
are passed as UTC (the columns are UTC timestamps without a zone).

## 10. Background worker (not created by this work)

`render.yaml` declares only the web service, so today the web process runs every job. To move jobs to a worker
(Render dashboard; nothing here creates it):

1. New → Background Worker, same repository and branch, Node. Build `npm install && npm run build`, start `npm run worker`.
2. Environment, same values as the web service: `DATABASE_URL`, `DEEPSEEK_API_KEY` (and any `DEEPSEEK_MODEL` /
   `SALES_*_MODEL`), the search keys in use (`TAVILY_API_KEY`, `LANGSEARCH_API_KEY`, `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`,
   `OUTBOUND_SEARCH_PROVIDERS`), `FIRECRAWL_API_KEY` if used, `GOOGLE_PLACES_API_KEY` if used, `MAILBOX_TOKEN_KEYS` and
   `MAILBOX_TOKEN_KEY_CURRENT`, every budget and allowance setting (`LLM_*_SPEND_USD`, `WORKSPACE_MONTHLY_SPEND_USD`,
   `OUTBOUND_*`), optionally `LEAGUE_EMAIL_REPORTS` with `RESEND_API_KEY`; plus `BACKGROUND_WORKER=external`. A shared
   environment group keeps the two services equal.
3. Add `BACKGROUND_WORKER=external` to the web service and redeploy it.
4. Check the logs for `worker_started` (with the database host) and a `worker_heartbeat` every minute.

What runs where once it exists: the worker claims Nibo/Mika/Zee tasks, schedules and campaigns and Client Radar runs
(leased, checkpointed, resumed after a deploy). The web service still answers requests (angles and drafts are made in the
request, not as jobs) and runs the mail timers (follow-up drafting every 2 minutes, Gmail reply sync every minute), so it
must stay always on either way.
