# DealInSec agent

An orchestration layer on top of the existing Copilot and domain services. It
reads, explains and prepares; the app's own validated services do the writing.

```
user (web today; voice / email later)
  → routes.ts            channel adapter: HTTP + SSE  ⇄  { channel, text } and events
  → loop.ts              explicit loop (no framework), real events, step/time budget
  → policy.ts            authorize → run | ask the user   (risk × autonomy level)
  → tools/*.ts           zod in → prepare / run / execute
  → copilot/tools.ts, services/*, storage     the app's own logic
```

## The rules it never breaks

- **The model only proposes.** A mutation tool `prepare`s (validates, describes,
  writes nothing). The policy then runs it (SAFE at autonomy 1) or stores an
  approval. An approved action executes the **stored, server-validated
  arguments** — never what the request or the model sends.
- **Consequential changes always ask**, at every level: sharing a link, creating
  an agreement or invoice, recording a payment. Changing a deal's amount and
  spending a free-plan credit force an approval too (`Prepared.forceApproval`).
- **Nothing deletes, and nothing edits an agreement or a signed document.**
- **Untrusted text is data.** Pasted messages and every tool result are fenced
  (`untrusted.ts`); the extraction call has no tools at all.
- **Nothing is invented.** `extraction.ts` tags every field stated / inferred /
  not specified / conflicting and checks each "stated" value against the message.
- **No personal text in logs or audit rows** (`log.ts`: `safeFields`,
  `summarizeArgs`; tool results are stored as a length only).

## Adding a tool

1. Write it in `tools/` as an `AgentTool`: `name`, `description`, zod `input`,
   `risk`, `authorize` (reuse `needsRead` / `needsPermission` / `allOf`), then
   `run` (READ_ONLY) or `prepare` + `execute` (a mutation). Wrap an existing
   service; don't copy its logic.
2. Add it to the list in `tools/index.ts` (`validateRegistry` checks it at startup).
3. Pick the risk class deliberately: if it makes something available to someone
   else, activates a record or moves money, it is `CONSEQUENTIAL_MUTATION`.
4. Add a case to `eval/cases.test.ts` (scripted) and one to
   `eval/dataset/agent-v1.json` (real model).

## Tests

- `npx vitest run server/agent` — pure tests plus the **evaluation suite**
  (`eval/`): the real loop, policy and tools against an in-memory world with a
  scripted model, covering extraction, injection, authorization, confirmation,
  failure/retry, edits and signed-agreement protection, and a seeded fuzz test
  of "no hallucinated fields".
- **Live evaluation** — `npx tsx --env-file=.env script/agent-eval.mts --live`
  runs the versioned dataset (`eval/dataset/agent-v1.json`) through the REAL
  model with the real loop, policy and tools against the in-memory world. It
  reports pass rate, safety failures (must be zero), invalid and repeated tool
  calls, tokens, estimated cost and latency, and `--compare` shows before →
  after. It spends model calls, so it is a separate vitest config
  (`vitest.live.config.ts`) that `vitest run` never picks up. See
  `docs/ai-engineering/01-evaluating-an-agent.md`.

## Voice and email: adding a channel

`conversation.ts` is the channel-agnostic layer. `converse(deps, { user, text,
adapter, sessionId?, context? })` runs one turn; it knows nothing about HTTP, a
phone call or an inbox. A channel is a `ChannelAdapter`:

```ts
{ channel: "web" | "voice" | "email",
  emit(event): void,        // deliver an event the channel's own way
  signal?: AbortSignal }    // the user has gone (closed tab, hung-up call)
```

- **web** (`routes.ts`): text from the browser; `emit` writes an SSE frame. A
  refusal before the agent starts (no such conversation, busy, over quota) comes
  back from `converse` as a typed failure with no events, so the route answers
  with JSON; once it has started, everything is an event.
- **voice** (not built): speech-to-text produces `text`; `emit` speaks the text
  of each `agent.message` and ignores cards and progress. The prompt already
  switches to short spoken replies (`channelStyle`). Approvals can't be given by
  voice yet: the agent says something is waiting in the app.
- **email** (not built): an inbound message becomes `text` on a session; the
  reply is queued as a **draft for the user's approval**, never sent. Sending an
  email will be a new CONSEQUENTIAL tool.

Nothing in `loop.ts`, `policy.ts` or the tools changes for a new channel
(`conversation.test.ts` runs the same turn through a web and a voice adapter and
checks the runs are identical). `wiring.ts` supplies the real database, model
and tools; tests inject fakes.
