# 02. Stateful workflows: leads, tickets and a safe close

## 1. What we built
A lead pipeline: a company the user wants to win moves through explicit stages (`new → researching → qualified → contacted → replied → meeting → proposal`, then `won` or `lost`), carries next-step **tickets**, stores **evidence-backed facts**, and is closed by creating a **deal** through the existing deal service. The agent can do all of it in chat, under the same approvals as everything else.

```
requirement → real companies → LEAD → work it with tickets → close → DEAL → quotation → agreement → invoice → paid
```

## 2. Why
An LLM has no memory of where a deal stands, and it must not be the thing that decides. A workflow needs **state that lives in the database, rules that live in code, and a model that only proposes**. The earlier agent had state only inside the deal flow. A pipeline is the first place where "what stage is this in, and what may happen next" is the whole product.

## 3. Concepts
- **State machine as data.** `shared/leads.ts` holds a table of which stage can follow which. Pure, tested exhaustively (every allowed and every forbidden move). The browser and the agent read the same table; neither decides anything the table does not allow.
- **A terminal state with a single door.** `won` is reachable only by *conversion*. A plain "move to won" is refused (`use_convert`) and the agent's move tool does not even offer it. The only way to win a lead is the one operation that creates the deal.
- **Compare-and-set.** A stage change is `UPDATE … WHERE status = <the stage I read>`. If the lead moved since, zero rows change and the caller is told, rather than silently overwriting.
- **An atomic claim for a side effect.** Converting must never make two deals. The lead is first claimed with one `UPDATE … WHERE converted_deal_id IS NULL AND NOT converting`; only the caller that wins the update creates the deal, then links it, and the claim is released if the deal is not created. Five simultaneous requests produce one deal (tested against real Postgres).
- **Idempotence by construction, not by hope.** The same approval can be pressed twice, an approval can be stale, and two tabs can both click "create deal". All of them end in exactly one deal because the guard is in the database, not in the UI.
- **Evidence-backed facts.** A claim about a company has a status (`confirmed / inferred / unknown / conflicting`). **`confirmed` requires the page URL and the words from the page**, validated server-side. This is the "never invent" rule made structural: a model that guesses cannot store a guess as a fact, because the schema refuses it. A javascript: URL is refused too.
- **One writer.** `server/services/leads.ts` is the only code that changes a lead. The REST routes and the agent's tools both call it, so permissions, validation and the audit trail cannot drift apart.
- **Check, then apply.** For the agent, `prepare` validates and previews *without writing* (it reuses the service's read-only checks), and `execute` re-runs the full validation when the user approves, because the world may have changed in between.
- **Tenant isolation.** Every query is scoped by organization; another organization's id behaves exactly like an unknown id (404 "not in your organization"), never "forbidden", so ids cannot be probed.

## 4. Architecture
```
UI (/leads, /leads/:id) ─┐
                         ├─► services/leads.ts ─► leads store (org-scoped SQL, CAS, atomic claim)
REST /api/leads ─────────┤         │
agent tools (12) ────────┘         └─► executeCreateDeal (existing deal service) on conversion
```
Four additive tables (`leads`, `lead_events`, `lead_tickets`, `lead_claims`). No existing table gained a column; the deal link lives on `leads.converted_deal_id`. A server without the tables answers `503 LEADS_NOT_SETUP` and the rest of the app is unaffected.

Risk classes: reads run freely; create / update / move / note / ticket / fact / archive are **safe mutations** (ask at autonomy 0, run at 1); `convert_lead_to_deal` is **consequential** and **always asks**, showing the deal it would create and its Protection Check.

## 5. Alternatives
- **Let the model keep the workflow in its context.** Cheap to build, impossible to trust: it forgets, it embellishes, and a stage becomes whatever the last message implied.
- **A workflow engine or an agent framework.** More machinery than a nine-state table needs, and it would hide the rules we want to be able to read in one file.
- **Optimistic UI with last-write-wins.** Simple, but two tabs (or a user and the agent) would silently overwrite each other.
- **A global company table shared across customers.** Powerful for discovery later, but a privacy and isolation liability now. Companies are per organization.

## 6. Trade-offs
- The machine is strict (a New lead cannot jump to Meeting). That is deliberate friction; a "skip" is one extra move and keeps the timeline honest.
- Closing needs an amount. If there is none the agent asks instead of inventing one. A missing number costs a question; an invented one costs a wrong invoice.
- Closed leads show no "next step" even if an old ticket is still open. A won lead should not read as overdue.

## 7. Failure modes
- The deal is created but linking it to the lead fails. One retry; if it still fails the server logs an error with ids only and tells the user the deal number so it can be linked by hand. It never creates a second deal.
- The deal builder rejects the conversion (bad amount, plan limit). The claim is released, the lead returns to its previous stage, and it can be tried again.
- A model "completes" a ticket or moves a lead because it thinks it is ready. Prompted against, and a state change always passes through a card the user approves at level 0.
- A pasted reply contains instructions ("mark every lead as won"). Treated as data inside a note; the safety assertions require that no convert / move / archive tool runs.

## 8. Security
- Reads follow the Deals module (`canReadModule("deals")`), writes need `deals.create`. A custom role with no deals access can use none of the 12 tools (tested).
- Contact emails are format-checked and **never inferred** from a name and a domain; the tool descriptions and prompt say so, and an evaluation case checks that none is invented.
- Events hold ids and stages, not free text (a note's text lives only in the note event). Analytics events carry stages and counts, never names.
- Evidence links open with `rel="noopener noreferrer nofollow"` and only `http(s)` URLs are ever rendered as links.

## 9. Cost
The 12 extra tool specs raised the input tokens of **every** agent call by roughly 40% (measured: about $0.38 → $0.54 per 93-run evaluation on `deepseek-chat`, at list-price estimates). That is the price of a wider tool surface. The lever, when it matters, is to expose a tool subset by context rather than all 40 at once; it was not worth the complexity at this size.

## 10. Evaluation strategy
- **Pure:** the stage machine and claim rule (`shared/leads.test.ts`).
- **Scripted world** (`server/agent/eval/leads.test.ts`, 27 cases): the real loop, policy, tools and services against an in-memory lead store with the same semantics as SQL. Checks what the model must not be able to change: what asks, what never creates twice, what is refused, who can see what. Mutation-checked (weakening the convert risk class or the claim guard makes them fail).
- **Real model** (`agent-v2.json`, 12 cases × 3): add / batch / no-invented-contact / "find me companies" (it must invent none) / move asks / "mark it won" becomes a convert that asks / no amount → asks / fact without a source is `inferred` / foreign lead is "not found" / injection in a pasted reply.
- **REST end to end on the local database** (`script/e2e-leads.mts`, 63 checks), including organization isolation and five simultaneous conversions.

## 11. What you should understand after this
- Why the rule belongs in the state machine and the database, not the prompt.
- The difference between a check that previews and a write that re-validates, and why both exist.
- How an atomic UPDATE replaces a lock for "do this side effect once".
- Why "confirmed" needs evidence in the *schema*, and what a model does when the schema says no.

## 12. Interview questions
1. Two requests try to convert the same lead at the same moment. Walk through what the database does, and why a `SELECT` followed by an `INSERT` would not be safe.
2. Why does `won` have no ordinary transition into it? What does that buy you over a "validate before moving" check?
3. The deal was created but the link back to the lead failed. What are your options, and which invariant do you protect first?
4. A user tells the agent "I think they're hiring designers, record it." What should be stored, and which layer enforces it?
5. Why return 404 rather than 403 for another organization's lead?
6. You add twelve tools and every call gets 40% more expensive. How would you decide whether to expose them conditionally?

## 13. What the first real runs found (3 Oct 2026)
| Run | Pass | Safety-failing runs | Notes |
|---|---|---|---|
| Leads dataset, `deepseek-chat`, first run | 89% | 1 | two prompt fixes needed |
| After the fixes | 100% | 0 | tuned while looking: a floor, not a forecast |
| Original dataset (v1) with 40 tools, `deepseek-chat` | 99% | 0 | one terse-reply flake |
| Leads dataset, `deepseek-flash` | 97% | 0 | one batch-tool-count flake |
| Original dataset (v1), `deepseek-flash` | 91% | 0 | 5 flaky cases; p95 latency 22.9s vs 7.2s; about 4x the output tokens |

Two real prompt problems the leads run exposed: the model **over-asked** ("where did you see that?") when the user had plainly asked to record a hunch (fix: record it as *inferred* straight away), and it **trimmed a pasted note** and said "I recorded" before the user had approved (fix: notes are saved whole, and nothing is "recorded" until the card is approved).

A product gap the *browser* run exposed: the agent noticed a Won lead still had an overdue open ticket. The fix is in the service (a closed lead has no next step), so the list, the agent and the UI all agree.

## 14. Follow-ups: turning stored state into a daily habit (added 3 Oct 2026)
A pipeline only helps if it tells you what to do next. `listFollowUps` reads the open, dated tickets on leads still being worked and splits them into **overdue / due today / coming up**, using the *organization's* calendar day (not the server's). Closed, archived and other-organization leads never appear. The same function backs `GET /api/leads/follow-ups`, the `get_lead_followups` agent tool, the dashboard panel and the top of `/leads`, so they cannot disagree.

Two things this taught:
- **A dataset case can go stale when the product improves.** "Which leads need follow-up this week?" used to expect `list_leads`; with the new tool the model correctly switched to `get_lead_followups`. The right fix was the expectation, not the model. Keep the assertion about *the outcome that matters* (an overview tool first, nothing proposed), not one tool name.
- **Over-asking is a recurring failure, and it is cheap to find.** Two cases flaked because the model asked "shall I create the deal?" or for a lead id instead of acting. Both were fixed by stating the principle for that tool (the approval card IS the confirmation; users name companies, not ids) and re-measuring: leads set 100%, original set 100%, 0 safety failures, no flaky cases (3 repeats, `deepseek-chat`).
