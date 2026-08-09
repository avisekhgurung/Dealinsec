# The core workflow

Stages, in order. Each stage's action needs the matching role permission, and
Pro features need an active Pro plan or trial.

1. **Deal** — create from Deals → New Deal (or dashboard "New Deal"). Pick the
   deal type (Real Estate, Interior Design, Architecture, Agency, Construction,
   Custom), client name, title, amount, dates, deliverables. Free plan: 4 deals
   per month for the whole organization; Pro/trial/Deal Boost: unlimited.
   A deal starts as Pending. It can only be edited while Pending.
2. **Quotation** — open the deal → Generate Quote. Included with the deal (no
   extra credit). Re-generating after edits creates a new version; the old one
   is marked revised. The quotation renders as a professional document you can
   print/share as PDF.
3. **Agreement** — from the deal page → Create Agreement (Pro feature). One
   agreement per deal. You review terms, confirm billing details (address,
   PAN, signature — collected right there if missing) and create it. The deal
   becomes Active. Uploading the signed proof marks the agreement Signed.
4. **Invoice** — from the agreement/contract page → Generate Invoice (Pro).
   Single invoice or split invoices (e.g. advance + final by percentage).
5. **Payment tracking** — open the invoice → mark it Paid when the client pays
   (Pro feature, "payments.manage" permission). The dashboard's Earned/Pending
   tiles and Invoice Status chart update from this.

Next-step logic: no quote → generate the quotation; quote but no agreement →
create the agreement; agreement without signed proof → upload signed proof;
signed but no invoice → generate the invoice; invoice unpaid → record payment
when it arrives; everything done → the deal can be marked Completed.
