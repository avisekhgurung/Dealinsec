# 09. The sales agent: from a lead to a first message, with a person deciding

The founder asked for an AI sales agent inside DealInSec: research a lead, score it, say what to do next, write the outreach, and never send anything or commit to anything without a person approving it. This is what V1 built, what it deliberately is not, how to run it, and what real data taught us.

## What it is
A lead (a company the user is pursuing) goes through five bounded steps. Each is a small program with one job, not an autonomous agent:

```
lead -> research -> score + next best action -> draft first message -> person approves -> person sends from their own email app -> "I sent it"
```

| Step | What does the work | What it writes |
|---|---|---|
| **Research** | Code fetches the lead's own site (home page + up to 2 same-site pages). ONE model call proposes findings, each with an exact quote. Code keeps a finding only if the quote is really on the page. | `lead_claims` (with the page URL and the quote), one `lead_research` row |
| **Score + next action** | Pure rules, no model (`shared/lead-score.ts`, `shared/next-action.ts`) | nothing |
| **Draft** | ONE model call (plus at most one retry) from verified facts only. Code rejects prices, links, other addresses, placeholders, false history, instruction-like text (`shared/outreach-check.ts`). | one `lead_messages` draft |
| **Approve** | A person, on the lead page or on an agent approval card that shows the exact text | status `approved`, who and when |
| **Send** | **The person**, from their own email app ("Open in my email app" / Copy). DealInSec has no way to send. | "I sent it" records it: status `sent`, the lead moves to Contacted, a follow-up ticket 4 days out |

The agent (chat and voice) has six tools over the same services: `get_lead_score`, `research_lead` (always asks), `draft_outreach`, `get_outreach_draft`, `approve_outreach` (consequential: always asks, shows the full text, bound to that text), `mark_outreach_sent`. **No tool sends.** A test asserts no registered tool name matches send/email/sms/whatsapp.

## Why code decides and the model reads
The model is good at reading a page and writing a paragraph, and bad at being believed. So:
- **A finding needs an exact quote that is on the page** (whitespace and typographic quotes normalised, nothing else). Judgments (`pain_point`, `opportunity`, `buying_signal`, `timing`) are never better than *inferred*, however well quoted. Contact emails must be role mailboxes (info@, hello@...) on the lead's own domain. Instruction-like text is dropped. A rejected finding is counted, never stored.
- **The score is arithmetic.** 100 points over six parts. A part that is unknown earns 0 *and is listed as unknown*; the UI says "42 of 100, 30 points unknown" so a low number caused by missing data is not read as a bad lead. Facts about activity (news, hiring, launch) are capped at half of the buying-signal part: a launch is a reason to look, not evidence of intent.
- **A draft is written from verified facts, never from page text.** The model sees a short list of confirmed facts, labelled guesses (never to be stated as fact), the sender's offer and their own notes, all fenced as untrusted. It never sees contact details.

## Safety invariants (each has a test, and each was mutation-checked: break the guard, a test must fail)
- Nothing is sent by DealInSec. The send step is a person, in their own email app.
- A lead marked **do-not-contact**, closed, archived, or already contacted gets no draft; and it is checked **again at approval** (the flag may have been set since the draft was written).
- Approval is of **one text**: the approver sends the hash of what they read, and the approval fails if the text changed. Editing an approved message sends it back to draft.
- One unsent message per lead is enforced by a **partial unique index**, not a check-then-insert. Every status change is one atomic `UPDATE ... WHERE status = <expected>`: three simultaneous clicks do the work once (tested at the loop level and against real Postgres over HTTP).
- No price, discount, percentage, rate, guarantee, deadline, link, foreign address, placeholder, markup, "as we discussed", or instruction-like text in a model-written draft. A person's own edits are held only to structure (length, placeholders, markup): their own price is theirs to write.
- Another workspace's lead, message, claim or note is "not found" in every direction. The prompt never contains another workspace's data.
- The timeline, logs and trace store ids, counts, codes and token numbers. **Never message text or prompts.**
- The agent never invents an address: with none on record, `draft_outreach` refuses and the agent asks the user.
- Daily allowances (per workspace, per task) are **counted from the durable `llm_calls` table**, not memory: the instance sleeps and memory resets. If the count cannot be read, the call is refused (fail closed).

## Tables and migrations (additive, run by hand)
Dev and production share one database, so nothing migrates on boot. Each table has its own script (`CREATE ... IF NOT EXISTS` only) and its feature turns itself off with a 503 until the table exists:

| Script | Table | Without it |
|---|---|---|
| `script/migrate-llm-calls.ts` | `llm_calls` (task, model, prompt version, tokens, latency, estimated cost, ok/error, lead, org; no text) | research and drafting are off (`SALES_NOT_SETUP`), score and next action still work |
| `script/migrate-lead-research.ts` | `lead_research` (one running run per lead, enforced by a partial unique index) | research is off |
| `script/migrate-lead-messages.ts` | `lead_messages` (one unsent message per lead, enforced by a partial unique index) | drafting is off (`MESSAGES_NOT_SETUP`); the lead page simply has no message section |

```bash
npx tsx --env-file=.env script/migrate-llm-calls.ts
npx tsx --env-file=.env script/migrate-lead-research.ts
npx tsx --env-file=.env script/migrate-lead-messages.ts
```

Run them on production **before** pushing the code that uses them. They are safe to run twice.

## Endpoints (all authenticated; read = whoever can read deals, write = whoever can create deals)
`GET /api/sales/leads/:id/score`, `/next-action` · `POST` and `GET /api/sales/leads/:id/research` (202, then poll) · `GET /api/sales/leads/:id/messages` · `POST /api/sales/leads/:id/draft` · `PATCH /api/sales/messages/:id` · `POST /api/sales/messages/:id/approve | sent | cancel`.

## Environment variables (all optional)
| Variable | Default | What it does |
|---|---|---|
| `SALES_RESEARCH_MODEL`, `SALES_DRAFT_MODEL`, `SALES_CLASSIFY_MODEL` | `deepseek-flash` | The model for each task (DeepSeek Flash, the founder's choice). If the provider's current Flash model has another name, set these; no code change. Deliberately **not** inherited from `DEEPSEEK_MODEL`. Letters, digits and `- . _ : /` only. |
| `SALES_DAILY_RESEARCH_LIMIT` | 20 | Research runs per workspace per rolling 24 hours |
| `SALES_DAILY_DRAFT_LIMIT` | 40 | Drafts (a retry counts) per workspace per 24 hours |
| `SALES_DAILY_CLASSIFY_LIMIT` | 200 | Reserved for V2 (reply classification) |
| `SALES_NEGOTIATE_MODEL` | `deepseek-v4-pro` | Reserved for V3 (negotiation, hard multi-step decisions, high-value deals). Nothing calls it yet. |
| `SALES_DAILY_NEGOTIATE_LIMIT` | 20 | Reserved for V3 |
| `LLM_PRICE_IN`, `LLM_PRICE_OUT` | 0.27, 1.10 | USD per million tokens, for the cost estimate in `llm_calls` (an upper bound: cache discounts are not modelled) |

## Model router
`modelFor(task)` in `shared/llm-cost.ts` is the router: **DeepSeek Flash** for research, classification, scoring explanation, outreach, reply analysis and normal tool calling; **DeepSeek V4 Pro** only for the V3 "negotiate" task. Every call is traced per task and model in `llm_calls`, so the cost of each choice is measured, not guessed. Note the agent's own chat model is `DEEPSEEK_MODEL` (separate setting); the table above governs only the sales tasks.

## Prompt versions
`research-v1` and `draft-v1` are recorded on every call and every row. **Bump them whenever the prompt text changes**, so a change in results can be tied to a change in the prompt.

## What real data taught us (not what we guessed)
1. **A reasoning model returned empty replies.** The app-wide `DEEPSEEK_MODEL` is `deepseek-flash`, which can spend its whole token budget thinking and return nothing. 2 of 8 real research runs came back empty. The sales tasks now have their own model setting, and an empty reply is its own error (`empty_output`), not "malformed". The founder then chose DeepSeek Flash as the default for these tasks anyway; with the retry in drafting and the explicit `empty_output` error for research, an empty reply is visible and retryable instead of silent. Measure it before relying on it (see the results below).
2. **The score overstated intent.** A real site's "we opened a second hotel" scored as a full buying signal. Activity facts are now capped at half of that part.
3. **Next action and score disagreed** about whether a lead had a way to be contacted when the email came from research. Both now use the same rule.
4. **Timestamps skewed by five and a half hours.** `DEFAULT now()` on the database (IST on the dev machine) against UTC from the app made "within 24 hours" counts wrong. Every new table's timestamps are written from the app in UTC; the allowance never relies on `DEFAULT now()`.
5. **A pathological string hung the checker.** A 100,000-letter draft made a regular expression backtrack. The scanned text is now bounded (anything longer is refused for its length anyway), domain detection works one word at a time with an anchored pattern, and an adversarial test feeds 200,000 characters of each shape and requires under a second. The mutation that removes the bound *hangs the test runner*, which is the point.
6. **A waiting message should outrank "research it".** A lead whose facts were typed in by hand (never researched) with a draft waiting said "Research this company". A message that already exists is what to act on.
7. **The agent drafted when asked to approve.** The live eval caught the model writing a draft on its own when the user said "approve the email" and none existed. The prompt now says to ask first; the case stays in `agent-v3`.
8. **The eval's own regex was negation-blind.** "nothing has been sent" matched "has been sent". Fixed with lookbehinds; the regex is checked against sentences it must and must not match.

## What is deliberately not built (and why)
- **Automatic sending.** Needs, first: a separate sending subdomain so a mistake cannot damage `support@dealinsec.com`'s reputation, a **suppression list** (unsubscribe and "stop contacting me" must be remembered and checked before every send), an unsubscribe link and a postal address in the message, and a database-counted daily cap. That is V1.5; the `MessageChannel` idea is in place (`channel = manual`) so adding `email` changes the send step, not the rest.
- **V2 (replies): inbound webhook, intent classification, stage recommendation, reply drafting.** Needs a signed inbound endpoint and a job table for scheduled follow-ups (the app has no queue; one Render instance sleeps).
- **V3 (negotiation, quotation, agreement, payment, won).** Needs a business-set minimum price the agent can never go below; `won` stays reachable only through `convertToDeal`.
- **WhatsApp/SMS, more model providers, long-term memory beyond claims.** The provider interface is ready; nothing needs them yet.
- **Accepting a found business email as the lead's own contact email** is not built: research never sets `contactEmail`. A found address is used as the recipient, labelled "found on their website".
- **Suppression** (a "do not contact" list across leads/emails) is deferred with automatic sending: while a person sends every message themselves, the lead's own `doNotContact` flag is the control.

## Results (4 Oct 2026)
| Run | Model for the agent's chat | Result |
|---|---|---|
| `agent-v3` (17 sales cases x 3), first run | `deepseek-flash` | 88%, **4 safety failures**: the agent wrote a draft on its own when asked to approve one that did not exist; and the eval's "was it sent?" pattern matched "nothing has been sent". Prompt rule added, pattern fixed |
| `agent-v3`, after the fixes | `deepseek-flash` | **100%, 0 safety failures** (51/51) |
| `agent-v1` (31 cases x 3), prompt changed | `deepseek-chat` | **100%** (93/93), 0 safety failures |
| `agent-v1`, same prompt | `deepseek-flash` | 88%, 0 safety failures. The misses are in cases unrelated to sales (read-attention, basic deal creation): Flash as the chat model is less steady on the older cases than Chat. Not a regression from this work: an earlier Flash run was 91% |
| `agent-v2` (45 cases x 3), prompt changed | `deepseek-chat` | **99%** (133/135), 0 safety failures; two single-run flakes (lead-move-asks, lead-fit-excluded) |

**Research yield on real sites with Flash** (8 public sites, real fetch, real model): first version 5 of 8 completed (3 empty or unreadable replies from the reasoning model). After giving the call a 4,000-token budget (Flash counts its thinking against it) and one retry for an empty or unreadable reply: **8 of 8 completed**, about 6 seconds and about $0.002 per run; one site honestly yielded nothing (a site with nothing quotable). Research drafts and e2e (69 checks) pass on Flash.

## Evaluating it
- Unit and loop tests: `shared/*.test.ts`, `server/agent/eval/{sales,research,outreach,sales-tools}.test.ts` (in-memory world, scripted model, the real services and rules).
- Real database and a real model: `script/e2e-sales.mts` (against the local test database only; refuses anything else).
- Live agent evaluation with the real model: `npx tsx --env-file=.env script/agent-eval.mts --live --dataset agent-v3.json` (17 sales cases). Because the prompt changed, `agent-v1` and `agent-v2` are re-run too; the results are in the section below.
- Weak tests found by surviving mutants, and strengthened: domain checks hidden by the quote check, a dead claim cap, a stale-run test that backdated the wrong row, an assertion that only checked the first words of a retry, a race that the pre-check made untestable (now tested by injecting an edit between the read and the write).

## Runbook
- *The lead page has no First message card:* the table is missing. Run `migrate-lead-messages.ts`.
- *Drafting says "isn't set up":* `llm_calls` is missing. Run `migrate-llm-calls.ts`.
- *Research stays "running":* the instance slept mid-run. After 3 minutes it reads as failed and can be retried.
- *"Today's drafts are used up":* raise `SALES_DAILY_DRAFT_LIMIT`, or wait; the count is the last 24 hours of `llm_calls`.
- *A draft keeps being rejected:* the safety checks refused it twice. Nothing is stored. Write the message by hand; the reasons are in the 422 `issues` codes, never the text.
- *Spend:* `SELECT task, count(*), sum(cost_micro_usd)/1e6 AS usd FROM llm_calls WHERE created_at > now() - interval '1 day' GROUP BY task;`
