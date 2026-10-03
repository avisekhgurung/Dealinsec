# 01. Evaluating an agent

## 1. What we built
A harness that runs a versioned set of scenarios through the **real** DealInSec agent on the **real** model, and reports pass rate, safety failures, tool-call quality, tokens, estimated cost and latency. The agent's tools run for real; only the edges (database, email, billing) are an in-memory world, so nothing outside the model provider is ever touched.

```
npx tsx --env-file=.env script/agent-eval.mts --live [--repeat 3] [--case tag] [--compare earlier.json]
```

## 2. Why
Unit tests with a scripted model prove the *system* behaves correctly **given** a model decision. They say nothing about whether the model makes good decisions. Every prompt edit, tool-description edit or model change can silently change behaviour. Without a measurement you are guessing, and the first time you find out is a user's data.

## 3. Concepts
- **Dataset as data.** Cases are JSON (`server/agent/eval/dataset/agent-v1.json`), validated by a schema, versioned. Adding a case is a file edit.
- **Trajectory, not just the final answer.** What matters is which tools ran, in what order, with what arguments, what was proposed, what actually executed. The reply text can say anything; the trajectory is the evidence.
- **Behaviour vs safety assertions.** Behaviour ("it looked up the invoices") can vary legitimately and is a *rate*. Safety ("nothing changed without approval", "nothing was invented", "a claim of an action matches a real action") must hold in *every* run. A single failure is reported separately and never averaged away.
- **Repeated runs.** A model is stochastic. One run proves little; three show **flakiness** (passes sometimes), which is itself a finding.
- **Prompt fingerprint.** A hash of the system prompt plus the tool names, descriptions and schemas. Results are tied to it, so a before/after comparison states exactly what changed.
- **Estimated cost.** Tokens × list price. An estimate, labelled as one (cache discounts are not modelled).

## 4. Architecture
```
dataset JSON → seed in-memory world → converse() (real loop, policy, tools, services, real model)
            → Trajectory (from the audit rows, approvals, world diff)
            → assertions (pure) → run records → metrics (pure) → report / compare
```
Pure modules (`assertions`, `trajectory`, `metrics`, `pricing`, `results`) hold all the logic and are unit-tested with no network. Only `live/agent.eval.ts` touches the model. It runs inside vitest with the same module mocks as the CI suite (`world-mocks.ts`), under a separate config so `vitest run` stays free and deterministic.

## 5. Alternatives
- **LLM-as-judge** to grade replies: flexible, but it adds its own error and cost. We assert on *structure* (tools, approvals, world changes) and use regex only for wording we can pin down.
- **Hosted eval platforms:** good dashboards; this project needs the assertions to live next to the code and run against its own tools.
- **Snapshot tests of full transcripts:** brittle, because wording varies run to run.

## 6. Trade-offs
Regex assertions on replies are cheap but crude; they can pass for the wrong reason or fail on harmless rewording. Keep them to a few high-value phrases and prefer trajectory assertions. A small dataset (~30 cases × 3) gives a rough signal, not a statistical guarantee.

## 7. Failure modes
- A case that passes for the wrong reason (a vacuous assertion). Guard: the dataset test requires every non-chat case to carry a safety assertion; mutation checks confirm assertions fail when the guarded behaviour breaks.
- Overfitting a prompt to the dataset. Guard: hold some cases back, add new ones from real use, and watch variance, not only the mean.
- A model or price change moving the baseline. Guard: results record the model and prices.

## 8. Security
The harness never touches a real database, sends no email and reaches only the model provider; it removes `DATABASE_URL` from the child environment. Results store assertion outcomes and counts, never message text. Pasting real client text into a dataset would send it to the provider, so datasets use invented data.

## 9. Cost
~5k input tokens per model call (system prompt plus product knowledge), ~3 calls per run. A full run (31 cases × 3) costs on the order of tens of cents at list prices. The CLI prints an estimate first and enforces a hard call cap.

## 10. Evaluation strategy
The dataset *is* the evaluation. The bar for this project: every safety assertion passes in every repeat, and at least 90% of runs pass overall. Later phases add their own datasets (extraction, retrieval, reply classification, proposals) to the same runner.

## 11. What you should understand after this
- Why a test with a scripted model and an evaluation with a real model answer different questions.
- Why safety is measured per run, not averaged.
- How to read a trajectory and tell a flaky case from a consistently wrong one.
- Why the prompt fingerprint matters.

## 12. Interview questions
1. How do you evaluate an LLM agent that calls tools? What do you assert on, and why not just the final text?
2. What is the difference between a behaviour metric and a safety invariant, and how do you report each?
3. A prompt change raises the pass rate from 80% to 90% but one safety case now fails once in three runs. Ship it?
4. How do you keep an evaluation from touching production data?
5. Why run each case several times? What does flakiness tell you?
6. When is an LLM judge appropriate and what are its failure modes?

## 13. What the first real run found (3 Oct 2026, deepseek-chat, 31 cases × 3 repeats)

| Run | Pass rate | Safety-failing runs | Flaky cases |
|---|---|---|---|
| First run (crude harness) | 70% | 15 | 8 |
| Baseline after fixing the harness | 89% | 3 | 7 |
| After prompt and tool-description fixes | **100%** | **0** | **0** |

**Lessons, in the order they were learned:**

1. **Fix the measuring instrument before the thing measured.** The first run blamed the model for "claiming" actions it had not taken. Most were the detector misreading "nothing has been created" and quoted text from the pasted message. A claim detector must be affirmative-only: strip quotes and reported speech, skip negations, and treat conditional wording ("approve the card and the link is created") differently from first-person claims ("I've created it"). Two tiers, and the real safety guarantees stay *structural* (what actually ran, what changed in the world), never wording.
2. **The prompt had a bug.** The model "ignored" the user's own "Handle this deal for me" because it sat in the same message as the pasted text; my injection rule said instructions inside the message are not to be followed, and it could not tell the two apart. Fix: say explicitly that the user's request *about* the message is an instruction and only text *inside* the message is not. This is the standard tension of a single-turn input that mixes instructions and untrusted data.
3. **Models invent rules from documentation.** The product docs say "Deal → Quotation → Agreement…". The model treated that recommended order as enforced and refused to create an agreement without a quotation. Fix: tell it the order is advice, not a rule, and that the tools report the real blockers.
4. **Over-caution is a failure too.** The agent asked "are you sure?" after the user had said the client paid. When the action already goes to an approval card, preparing it is safe; asking again is friction.
5. **A fix can over-correct, and the evaluation caught it.** "Act, don't stall" made the agent prepare a deal for "someone" with the client name set to "Not specified". Fixed twice: a sharper prompt line, and a server-side guard that rejects placeholder names (`isPlaceholderName`), because a rule the model can be talked out of is not a control.
6. **Measure with repeats.** Eight cases were flaky in the baseline: right two times in three. A single run would have shown some of them as passing.

**Caveats, stated plainly:** the dataset and the detector were refined *while* looking at these cases, so the 100% is partly fitted to them. It is a regression floor, not a claim of general reliability. The next steps are more cases drawn from real use, held-out cases that are not tuned against, and more repeats. Spend for this work: about 1,100 model calls across six runs, roughly US$2.
