# 06. Revising quotations and agreements, and how documents look

The founder asked that the agent be able to change a real quotation, a real agreement, and the PDF format. All three are done as ordinary tools behind the same policy, approvals and role checks as everything else. Nothing here lets the agent do what the signed-in person could not do.

## Quotation = a rendering of the deal
A quotation has no data of its own; it is the deal's terms laid out on a page. So **"revise the quotation" means "edit the deal, then regenerate the quote"** (`revise_quotation`, `server/services/revisions.ts`).
- Only while the deal is **Pending**. Once work has started the numbers are a commitment, so the agent refuses and says why.
- Needs `deals.edit` and `quotations.create`.
- Edits are structured (`dealEditSchema`): amount, add or remove terms, replace deliverables. Removing a term needs an **exact whole-line match**, so "remove the 30-day clause" cannot quietly delete a different line.
- A **change of amount always asks**, whatever the autonomy level (`forceApproval`). Other edits follow the normal rule.
- If a client link is already live, the approval card says the client will see the new version.

## Agreement revision is stricter on purpose
`revise_agreement` is a CONSEQUENTIAL tool: it always asks, and by voice it needs the word "confirm".
- **Refused once anyone has signed** (`signedByBrand` or `clientSignedAt`). A signed agreement is hashed and immutable; the answer is a new agreement, not an edit.
- Only the **signer** of the agreement (`signerUserId`) can revise it, because the issuer signature is re-dated.
- An active signing link is **revoked** (`clientShareRevokedAt`), so the client can never sign a version they were not shown.
- A change of currency is refused when it would change the fee (a number in one currency silently becoming another).
- Needs `agreements.create` and `deals.edit`. Activity is logged.

## Document style (the "PDF format")
A small, fixed menu, so nothing typed can become CSS: **8 accent colours, 2 fonts, a footer note of at most 160 characters** (`shared/document-style.ts`).
- An accent is three colours: brand (text and rules), soft (tinted panels) and end (the far end of the header band). Every brand colour is tested for 4.5:1 contrast on white and every band end for 3:1 (it carries only large white text), so no choice produces an unreadable page.
- They become CSS variables (`--doc-brand`, `--doc-brand-end`, `--doc-brand-soft`, `--doc-font`) on both the visible pages and the hidden measuring column, so pagination matches what you see.
- The footer note is on quotations and invoices; **not on agreements**, whose text is hashed and signed.
- Set in Settings > Document look (live preview) or by asking the agent (`get_document_style`, `update_document_style`; needs `org.settings`). Stored per organisation in `document_styles`.
- Lookups use `hasOwnProperty`: the `in` operator treats `"__proto__"` as present. A test covers `__proto__`, `constructor`, `toString`.

## Deploy note
New table `document_styles`. Run **before** pushing:
```
npx tsx --env-file=.env script/migrate-document-style.ts
```
Without it only the style feature answers 503 (`DOCUMENT_STYLE_NOT_SETUP`); everything else, including revisions (which add no table), works.

## Lessons
- A hard-coded colour hides in CSS you did not write the feature for: the header band stayed green until a real browser check showed it. Grep the stylesheet for hex values when adding a theme.
- Mutation checks (remove the lock, the signer check, the forced approval, the pending-only rule, the link revocation, the exact-match rule) each made a test fail. One of my first mutations changed nothing and still passed; I redid it. A test that survives its mutation is not a test.

# "Superuser": what the agent can do, and what it never does

The founder asked for the agent to have control of the whole app. The design: **a superuser within the signed-in person's own role and workspace, and nothing past it.** Every tool runs through the same policy as the screens: the person's own permission, the same plan check, the same organisation boundary. The agent never has a key the person does not have, and never reaches another workspace (tested in each tool's suite).

## Three tiers
| Tier | What | How |
|---|---|---|
| A: does it, with the usual approval | create/edit leads, deals, quotations; revise a pending quotation; ideal-client; company search; document look; an invoice's due date and note; workspace industry and work type; phone | asks at autonomy 0, runs at 1 |
| B: always asks, whatever the setting | convert a lead, agreement, signing link, invoice, record/reverse a payment, complete a deal, revise an agreement, a price change, the workspace name, anything printed on documents (tax id, GST, billing address, the person's name) | by voice only on the word "confirm" |
| C: never by the agent | delete anything, bank details, signature and seal, email and password, plan and billing, team invitations and roles, API keys, region and currency, the agent's own approval setting, editing a signed document | the agent says in one sentence that the person does it in Settings, names the screen, and offers the nearby part it can do |

Why tier C is not "ask first": a tier-C mistake cannot be undone, or it decides who has access to the business. Text the agent reads (a lead's website, a pasted email) is untrusted, and the worst thing such text can do must stay bounded. An invitation emails a stranger and hands them the workspace; the agent's own approval setting is the lock on everything above. Neither should be one "yes" away.

## What was added in this step
`complete_deal`, `update_invoice_details`, `update_workspace_profile`, `update_my_details` (`server/agent/tools/workspace.ts`, `server/services/workspace.ts`, `shared/workspace.ts`). The fields they accept are an allowlist enforced by `.strict()` schemas, so `{ status: "Paid" }` or `{ accountNumber }` is not "ignored": it is rejected, and the model is told. An invoice's amount, number, client and status are not inputs of `update_invoice_details`; payment goes through `mark_paid`, which always asks.

## Lessons
- **My coverage audit was wrong the first time.** I listed gaps by grepping for `name: "..."`, which missed every tool built by a factory function (`mark_paid` was "missing" but existed). Read the registry at runtime, not the source text.
- **Two layers, both tested.** The tool's `authorize()` blocks a role first, so a mutation that removed the service's own check survived the tool-level tests. Services are also called from places that are not tools; so the service re-checks, and a test calls the service directly. Of the 12 mutations tried on this step, the only one that survived at first was that one.
- A test whitelist (`15b`: what a member with no permissions can use) caught `update_my_details` being open to everyone. It is correct (the profile route needs only a signed-in user), and the whitelist now says why.
