# The core workflow

Prospect → Lead → Deal → Quotation → Agreement → Invoice → Payment tracking.
Each stage's action needs the matching role permission; agreements, invoices
and payment tracking need Pro or the trial.

0. **Prospect** — AI Outbound (/outbound): describe who you want, confirm the
   profile, start the search (it runs for a minute or two). Review the
   prospects with their evidence and score, then "Add to Leads" for the ones
   worth pursuing.
1. **Lead** — Leads (/leads) or added from AI Outbound. Record facts, set next
   steps, draft and approve a first message, send it from your own email and
   mark it sent. When the lead is won, "Turn into a deal" creates its deal and
   marks the lead Won.
2. **Deal** — Deals → New Deal (or from a won lead). Pick the engagement model
   and service, then client, title, value, dates and deliverables. Free plan:
   4 deals a month for the organization; Pro/trial: unlimited. A deal starts
   Pending and can be edited only while Pending.
3. **Quotation** — open the deal → Generate Quote (included with the deal).
   Re-generating after edits makes a new version. Share the acceptance link
   or print/PDF.
4. **Agreement** — from the deal → Create Agreement (Pro). One per deal.
   Review terms, confirm billing details, create it; the deal becomes Active.
   Send the signing link, or upload a signed copy; either marks it Signed.
5. **Invoice** — from the agreement → Generate Invoice (Pro). Single or split
   (for example an advance and a final invoice by percentage).
6. **Payment tracking** — open the invoice → mark it Paid when the client pays
   (Pro, "payments.manage" permission). Paid, pending and overdue update.

Next-step logic: no quote → generate the quotation; quote but no agreement →
create the agreement; agreement unsigned → send the signing link; signed but
no invoice → generate the invoice; invoice unpaid → record payment when it
arrives; everything done → mark the deal Completed.
