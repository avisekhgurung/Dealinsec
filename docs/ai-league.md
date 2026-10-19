# The Nest (AI League in code): Nibo, Mika and Zee

Three AI coworkers inside DealInSec, at `/ai-league`. They share one runtime and one permission system: the existing
agent (server/agent) for chat, and the existing durable Postgres workflow runner (server/workflow/runner.ts) for tasks.

| Coworker | Role | Real work (a durable task) | Allowed in chat | Never |
|---|---|---|---|---|
| Nibo | Opportunity Hunter | `nibo.find_clients`: an Client Radar search (by "agent"), then up to 5 qualified companies saved to Leads | reads leads, ideal client, Client Radar runs and prospects | send messages, touch money, bypass Client Radar's or Leads' checks |
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
  app's own services as the person who started the task: Client Radar (`parseIcp`, `startRun`, `getRun`, `addToLeads`),
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
- **Durability.** The job is the `league_runs` row. A wait (Nibo watching its Client Radar search) parks the run: its lease
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
- Client Radar's search providers (Tavily etc.) and allowances for Nibo; the outreach draft allowance for Mika.

Optional limits (env, per plan; defaults in server/ai-league/limits.ts):

| Variable | Default (free / pro) |
|---|---|
| `LEAGUE_MONTHLY_RUNS_FREE` / `_PRO` | 10 / 60 tasks per rolling 30 days |
| `LEAGUE_CONCURRENT_FREE` / `_PRO` | 1 / 2 tasks working at once per workspace |
| `LEAGUE_SCHEDULES_FREE` / `_PRO` | 1 / 5 recurring tasks per workspace |
| `LEAGUE_RUN_MAX_MINUTES` | 45 |

These are settings, not a validated pricing model: each task also spends the underlying feature's allowance (Client Radar
searches and researched prospects, AI drafts), and the workspace's $1.50 30-day AI spend ceiling applies to every model
call. Nothing is unlimited.

## Research campaigns (Nibo, over hours)

`nibo.campaign` (server/ai-league/tasks/campaign.ts; times in shared/league-campaign.ts). "Work tonight: find 50 Indian
digital marketing agencies that may need web development, save the qualified ones, report at 8 AM IST."

- **Three times, stored as UTC instants:** start (now or scheduled), work-until (no new search starts after it; default
  15 minutes before delivery so the report is on time), deliver-at. A hard stop caps every campaign at 24 hours. Times
  are checked when the task is created (too soon, more than 7 days ahead, work after delivery, longer than 24 hours)
  and the person is told immediately.
- **Batches:** one Client Radar search per batch (each from the plan's allowance, up to 10 companies), at most 10 per
  campaign. A country-wide profile moves city by city (Mumbai, Bengaluru, Delhi NCR, Pune…) so batches find different
  companies. Results are de-duplicated by domain across batches and against Leads; only "ready"/"qualified" companies
  count, and they are saved through Client Radar's add-to-Leads with their evidence.
- **Durability:** each stage is a checkpointed step; waiting for the start, for a search (checked every 30 s) or for
  the delivery time parks the run, so nothing polls in between and a restart resumes from the checkpoint. A failed
  search is skipped; an allowance running out, the search cap or the work-until time stops new research; companies
  already found are still kept and saved.
- **Report before delivery:** the report is written and saved (`report_ready` event) at the end of research, held, and
  delivered at the requested time, complete or partial with its coverage and every limitation stated. Notifications:
  the in-app bell (`notified` event) and, with `LEAGUE_EMAIL_REPORTS=true`, an email to the account's own address
  (`emailed` / `email_failed`; a failed email never re-runs the research). CSV and Markdown downloads:
  `GET /api/ai-league/runs/:id/report.csv|.md` (your own tasks only; CSV formula cells are neutralised).
- **From chat:** `league_nibo_campaign` takes local wall-clock times (`deliverLocal: "2026-10-20T08:00"`); the server
  converts them in the person's timezone (their setting, else Asia/Kolkata) and the approval card shows them back
  ("Report Tue 20 Oct, 08:00 IST"). It always asks first. From the page: Nibo → Start a task → Campaign.
- **What 50 companies needs:** about 5 searches of 10 companies each, *if* about half qualify. Pro has 10 searches and
  100 researched companies per 30 days; Free has 3 and 30, so a 50-company campaign on Free ends partial by design.

## The background worker (Render)

`server/worker.ts` runs every durable job (AI League tasks, schedules and campaigns; Client Radar searches) in its own
always-on process, independent of browsers, requests and the web service.

- Jobs are Postgres rows claimed with a lease (`FOR UPDATE SKIP LOCKED`), checkpointed after each step and fenced, so
  two workers never hold one job and a restart, deploy or crash resumes from the last checkpoint (at-least-once steps,
  effectively-once internal writes: run creation, lead saves and report delivery are keyed or fenced).
- It kicks the runners every 30 s as a safety net (they also wake themselves for parked jobs), logs a JSON heartbeat
  every minute (uptime, busy runners, memory), logs the database host it uses (never credentials), and on SIGTERM stops
  claiming and gives in-flight steps up to 25 s; anything unfinished resumes on the next worker.
- **Set `BACKGROUND_WORKER=external` on both services** once the worker runs: the web service then records jobs but
  never works them (server/workflow/runner.ts `backgroundWorkIsElsewhere`). Without it (today), the web process works
  jobs itself, as before, and then needs an always-on instance.

Render setup (do this in the Render dashboard; render.yaml is unchanged so nothing is created by a push):

1. New → Background Worker, same repository and branch, runtime Node.
2. Build command `npm install && npm run build`; start command `npm run worker`.
3. Environment: the same values as the web service (at least `DATABASE_URL`, `DEEPSEEK_API_KEY`, the Client Radar
   search keys such as `TAVILY_API_KEY` and `FIRECRAWL_API_KEY` if used, `MAILBOX_TOKEN_KEYS`, `SESSION_SECRET` is not
   needed), plus `BACKGROUND_WORKER=external`. Optional: `LEAGUE_EMAIL_REPORTS=true` with `RESEND_API_KEY`.
4. Add `BACKGROUND_WORKER=external` to the web service and redeploy it.
5. Instance: the smallest paid always-on instance is enough to start (one process, one job slice at a time per runner);
   check current prices on render.com/pricing (not verified here: the page renders client-side).
6. Neon: the worker opens its own small connection pool; keep the total within the Neon plan's connection limit.

Local: `npm run dev:worker` (uses `.env`; prefix `DATABASE_URL=…` to point at a local database, as the dev server does).

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
- Nibo uses Client Radar's web search; the Google Maps "local businesses" search isn't wired into Nibo yet.
- Not built: browser automation (Playwright) and MCP connections. Both need infrastructure or credentials this
  repository doesn't have (a Docker-based Render service with Chromium's system libraries; vetted MCP servers with
  per-workspace authorization); see the coworker platform handoff. Research uses Client Radar's search and website
  reading, which already validates URLs and treats page text as untrusted.
- Campaigns can't be scheduled as routines yet (their times are absolute); quick tasks can.

## Mascots

`client/public/ai-league/{nibo,mika,zee}-mascot.webp` (512 px) and `*-mascot-sm.webp` (192 px), transparent WebP from the
supplied character art: Nibo (blue, magnifier), Mika (pink, letter), Zee (green, checklist); the identity colours in
`BOT_IDENTITY` follow them. Mika and Zee came with real transparency; Nibo's source had a checkerboard painted into an
opaque image, removed by a flood fill of its neutral greys (the floor shadow under the feet went with it). Rendered by
`client/src/components/ai-league/mascot.tsx` (`srcSet`, `object-contain`, lazy except where visible on first paint).
While a coworker works, the halo around the mascot animates (`league-halo` in index.css), never the image itself.

## Voices, calls and chirps

- **Read aloud, on request:** every reply (Agent mode and each coworker) has a row like a chat app's: Copy, Good,
  Bad, Share, Read aloud and Regenerate (the latest reply). Read aloud speaks that one reply in its writer's voice
  (`shared/voice-profiles.ts`: Nibo curious and quick, Mika warm, Zee calm); nothing is read automatically. The
  coworker's plush character talks while it plays (`hooks/use-read-aloud.ts`). Good/Bad are kept in the browser
  (`dis_reply_ratings`) and counted as a consent-gated analytics event, never with the message text.
- **Voice calls with Nibo, Mika and Zee:** "Talk" in a coworker's chat opens the same tested call as Agent mode's,
  with their character in place of the orb, their greeting, their voice, and a spoken style that keeps them
  themselves (`coworkerVoiceStyle` in server/ai-league/chat.ts; the chat route takes `channel: "voice"`).
- **Dictation:** the coworker chats have the same microphone as Agent mode (the browser's speech recognition).
- **Chirps** (`lib/chirps.ts`, played by `lib/chirp-player.ts`): each coworker's own short, original sounds when a chat
  opens, a task starts, work is really finished, or something waits for approval. One switch in The Nest, off until
  turned on (`dis_nest_sound`).

Voice provider (`server/voice/tts.ts`): **Sarvam AI bulbul** first when `SARVAM_API_KEY` is set (Indian voices,
code-mixed Hinglish, `hi-IN`), OpenAI as the backup for a sentence Sarvam can't make, and the browser's own voice (with
each coworker's pitch and pace) when neither is set up. Optional: `SARVAM_TTS_MODEL` (default `bulbul:v3`),
`SARVAM_TTS_LANGUAGE` (default `hi-IN`), `SARVAM_VOICE_AGENT|NIBO|MIKA|ZEE` to pick other bulbul speakers (with
`SARVAM_MODEL_<KEY>` / `SARVAM_LANGUAGE_<KEY>` when the speaker belongs to another model; Mika is Zarina,
`zarina_en_conversation` on `bulbul:v4-flash`, `en-IN`),
`VOICE_PROVIDER=openai` to force OpenAI. The same per-workspace daily character cap (`VOICE_DAILY_CHARS`) applies.
