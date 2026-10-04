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
