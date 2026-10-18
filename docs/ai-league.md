# AI League: Nibo, Mika and Zee

Three AI coworkers inside DealInSec, at `/ai-league`. They share one runtime and one permission system: the existing
agent (server/agent) for chat, and the existing durable Postgres workflow runner (server/workflow/runner.ts) for tasks.

| Coworker | Role | Real work (a durable task) | Allowed in chat | Never |
|---|---|---|---|---|
| Nibo | Opportunity Hunter | `nibo.find_clients`: an AI Outbound search (by "agent"), then up to 5 qualified companies saved to Leads | reads leads, ideal client, AI Outbound runs and prospects | send messages, touch money, bypass AI Outbound's or Leads' checks |
| Mika | Deal Specialist | `mika.first_messages`: first emails drafted by the outreach service for up to 5 leads, waiting for approval | reads leads, follow-ups, drafts, deals | send anything (drafts only; the person approves the exact text and sends) |
| Zee | Business Guardian | `zee.briefing`: what needs the person today, from invoices, agreements, deals, follow-ups, outreach | reads money radar, pending work, invoices, quotations, agreements, follow-ups | change records, claim anything the records don't say |

## Teamwork: the coworkers talk to each other

Talking changes nothing; doing still asks. All of it is in `server/ai-league/team.ts` and `chat.ts`.

| How | What happens | Bounds |
|---|---|---|
| **Ask a teammate** (`ask_teammate`, in any coworker's chat) | The teammate answers in its own voice from its OWN records, read through its own read tools as the person (Mika asking Zee never shows money to someone who can't see invoices). Shown as a "Nibo asked Mika" card. | Read-only; one model call with no tools, so a teammate can't consult further or act; at most `consultsPerReply` (2) per reply |
| **Hand off work** (`handoff_<from>_to_<to>`) | Starts the teammate's task (Nibo → Mika: draft first messages for the leads Nibo found). The report lands in the teammate's chat. | **Always** an approval card ("Nibo asks Mika: …"), whatever the autonomy setting: it spends the teammate's allowance |
| **Team huddle** (`team.huddle` task; the Team tab, a chat header, or `league_<bot>_huddle` in chat) | A background brainstorm: the lead opens, each coworker speaks once per round for two rounds, each turn a durable step, then the lead sums up with at most three next steps, each owned by one coworker | Counts as one AI League task; 7 model calls on the `team` AI allowance (`SALES_DAILY_TEAM_LIMIT`, default 60 calls a day per workspace; `SALES_TEAM_MODEL`) and the spend ceiling; an allowance refusal stops it with what was said |

Every teammate reply passes the same check as Zee's summary: a figure that isn't in the records, the question or
what was said before means that reply is left out (and marked), never shown. Records, topics and earlier turns reach
the model only inside `<untrusted>` fences, and a teammate's answer reaches the asking coworker fenced too.

## Architecture

```
chat:   POST /api/ai-league/bots/:bot/messages ─► converse() (agent loop) with the coworker's persona + tool allowlist
                                                   └─ league_<bot>_task tool ─► policy (Nibo always asks) ─► startLeagueRun
page:   POST /api/ai-league/runs ─────────────────────────────────────────────────────────────► startLeagueRun
schedule slot ─► scheduleWorkflow ───────────────────────────────────────────────────────────► startLeagueRun
startLeagueRun: validate (task's zod schema) → plan limits under an advisory lock → league_runs row (idempotency key) → kick
leagueWorkflow (durable runner): claim (lease, SKIP LOCKED) → task step as the person → fenced save → park / finish
finish: report + one activity-log notification (only when the fenced write won)
```

- **Deterministic steps, model for language only.** Task steps (server/ai-league/tasks/*) are TypeScript calling the
  app's own services as the person who started the task: AI Outbound (`parseIcp`, `startRun`, `getRun`, `addToLeads`),
  outreach (`draftOutreach`, `listOutreachQueue`), the dashboard briefing (`computeBriefing`, `listFollowUps`). The model
  only chats, picks which tool to call (from the allowlist), and writes Zee's two-sentence summary, which is dropped if
  it mentions a figure not in the records.
- **Identity and tenancy** always come from the session (routes) or the stored run (worker), never from the model or the
  request. Every store query is scoped by organization and user; a foreign id answers 404.
- **Untrusted text** (web pages, lead notes, remembered preferences, briefing items) reaches the model only inside
  `<untrusted>` fences; it can't add tools or change approvals.
- **Approvals.** Chat approvals are the agent's own (stored, server-validated arguments; single-use claim). Mika's drafts
  are the outreach queue's (approve the exact text by its hash; sending is the person's, from their email or their
  connected Gmail). Nothing in AI League sends a message.
- **Durability.** The job is the `league_runs` row. A wait (Nibo watching its AI Outbound search) parks the run: its lease
  is held until the next check, so nothing polls in between, and a restart resumes from the row. A failing step is
  retried twice (2 and 4 minutes), then the run fails with the reason. Cancel stops it at its next step. A run longer
  than `LEAGUE_RUN_MAX_MINUTES` stops with what it has. No transaction is held across a model call, web request or wait.
- **Schedules.** `league_schedules.next_run_at` is UTC; the time of day is in the person's IANA timezone (DST-safe). A due
  slot's run uses the slot as its idempotency key, so a restart or a second process can't create it twice. **Missed
  runs:** if the server was down through one or more slots, the schedule runs once when it's back and the next time is
  computed from then (no backlog).

## Database

Five additive tables (server/ai-league/ddl.ts; Drizzle definitions in shared/schema.ts): `league_threads`, `league_runs`,
`league_run_events`, `league_schedules`, `league_memory`. Chat messages stay in the agent's own tables
(`agent_sessions` / `agent_messages` / `agent_approvals`); AI League's sessions are hidden from Agent mode's history.

Apply once, deliberately (dev and production share the Neon database):

```bash
npx tsx --env-file=.env script/migrate-ai-league.ts
```

Until it runs, `/ai-league` says it isn't set up and nothing else changes. The agent tables (script/migrate-agent.ts)
must exist too. Rollback: `DROP TABLE IF EXISTS league_memory, league_schedules, league_run_events, league_runs, league_threads;`

## Configuration

No new secrets. AI League uses what the features it calls already use:

- DeepSeek (`DEEPSEEK_API_KEY`, the agent's provider) for chat and Zee's summary (`SALES_BRIEF_MODEL`, default the sales
  model; `SALES_DAILY_BRIEF_LIMIT`, default 30 a day per workspace).
- AI Outbound's search providers (Tavily etc.) and allowances for Nibo; the outreach draft allowance for Mika.

Optional limits (env, per plan; defaults in server/ai-league/limits.ts):

| Variable | Default (free / pro) |
|---|---|
| `LEAGUE_MONTHLY_RUNS_FREE` / `_PRO` | 10 / 60 tasks per rolling 30 days |
| `LEAGUE_CONCURRENT_FREE` / `_PRO` | 1 / 2 tasks working at once per workspace |
| `LEAGUE_SCHEDULES_FREE` / `_PRO` | 1 / 5 recurring tasks per workspace |
| `LEAGUE_RUN_MAX_MINUTES` | 45 |

These are settings, not a validated pricing model: each task also spends the underlying feature's allowance (AI Outbound
searches and researched prospects, AI drafts), and the workspace's $1.50 30-day AI spend ceiling applies to every model
call. Nothing is unlimited.

## Running the worker on Render

There is no separate worker service: like AI Outbound's prospect runs, the league runner lives in the web process
(server/index.ts kicks it at boot; every start, cancel and page view kicks it; it re-checks at least every 5 minutes
while runs or schedules exist). Work is durable because the state is in Postgres, not in memory.

**Requirement:** the Render web service must be an always-on instance (a paid instance type). A free instance sleeps
when idle: queued tasks and due schedules then wait until the next request wakes it (they are not lost, and run once on
wake). If AI League ever needs to scale beyond one instance, the claim is already safe across processes (leases and
`FOR UPDATE SKIP LOCKED`); a dedicated worker would run the same `kickLeague()` loop.

## Tests

- `shared/ai-league.test.ts`: schedule times across timezones and DST; task input bounds.
- `server/ai-league/tasks.test.ts`: Nibo (qualified only, ready first, limit, de-duplication, no invented contacts,
  allowance stop, failure reasons), Mika (eligible leads only, refusals as skips, allowance stop, honest empty run),
  Zee (empty day, real items and money, grounded summary, partial reads).
- `server/ai-league/runtime.test.ts`: durability across a restart, parking, fencing, cancel, time limit, member left,
  retry with backoff, unknown task, schedules (one run per slot, no backlog, paused).
- `server/ai-league/service.test.ts`: validation, idempotency, plan limits, isolation, schedules, memory (refuses
  credential-like values), chat tools (Nibo always asks, no send/pay/sign tools, strict inputs), persona prompt fencing.
- `server/ai-league/ai-league.pg.test.ts` (real local Postgres): concurrency cap and allowance under concurrent starts,
  one claimer, fenced writes, one schedule claim per slot.

## Known limitations

- Mika drafts **first** messages. Follow-ups are still the existing email follow-up sequence (template drafts at 3 and 5
  business days, never sent unreviewed); Mika doesn't write them yet. The "Waiting" view lists every AI-written draft
  waiting for approval under Mika, including ones Agent mode wrote.
- Run progress is polled (every 2.5 s while a task works), not streamed; chat replies stream (SSE).
- Notifications are the activity log the bell already reads; there's no email digest yet.
- Nibo uses AI Outbound's web search; the Google Maps "local businesses" search isn't wired into Nibo yet.

## Mascots

`client/public/ai-league/{nibo,mika,zee}-mascot.webp` (512 px) and `*-mascot-sm.webp` (192 px), transparent WebP from the
supplied character art: Nibo (blue, magnifier), Mika (pink, letter), Zee (green, checklist); the identity colours in
`BOT_IDENTITY` follow them. Mika and Zee came with real transparency; Nibo's source had a checkerboard painted into an
opaque image, removed by a flood fill of its neutral greys (the floor shadow under the feet went with it). Rendered by
`client/src/components/ai-league/mascot.tsx` (`srcSet`, `object-contain`, lazy except where visible on first paint).
While a coworker works, the halo around the mascot animates (`league-halo` in index.css), never the image itself.
