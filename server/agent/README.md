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
4. Add a case to `eval/cases.test.ts`.

## Tests

- `npx vitest run server/agent` — pure tests plus the **evaluation suite**
  (`eval/`): the real loop, policy and tools against an in-memory world with a
  scripted model, covering extraction, injection, authorization, confirmation,
  failure/retry, edits and signed-agreement protection, and a seeded fuzz test
  of "no hallucinated fields".
- `script/agent-eval-live.mts` — opt-in, spends DeepSeek calls, measures what a
  real model chooses. Local database only.

## Voice and email

`runAgent` takes `{ channel, text }` and emits events; it does not know where
text came from. A voice adapter adds speech-to-text before it and text-to-speech
on `agent.message`; an inbox adapter turns a message into a session. Neither
needs a change to the loop, the policy or the tools.
