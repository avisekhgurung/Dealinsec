# Feature highlights

- Dashboard: greeting, animated KPI funnel (Deals→Quotations→Agreements→Paid
  Invoices→Pipeline value), deal status split, Earned/Pending, deliverables
  chart, recent deals, trial countdown.
- Deal types carry India-specific taxonomies (brokerage %, per sq ft, % of
  construction cost, RA bills) and sector-specific agreement wording.
- Quotations: versioned, professional documents; print/PDF from the browser.
- Agreements: standard + custom terms, billing details collected just-in-time,
  signature image applied, signed-proof upload.
- Invoices record the agreed contract value and print PAN/GSTIN when set. They
  are NOT tax invoices under Rule 46 of the CGST Rules — DealInSec does not
  compute CGST/SGST/IGST on them, and the invoice says so in its footer. The
  free browser tool at /tools/gst-invoice DOES compute GST; the app does not.
  Never describe app invoices as "GST invoices" or "GST-ready".
- Invoices: single or split, attachments (e.g. GST invoice, TDS certificate),
  payment status tracking.
- Team: invites by email, join links, roles with a full permission matrix,
  activity log of who did what.
- Free public tools at /tools (invoice/GST/quotation generators) for marketing.
- PWA install, dark mode, keyboard shortcut [ to collapse the sidebar.

## Copilot AI (in-app assistant)
- Create a deal from a pasted WhatsApp chat, email thread or a plain request:
  Copilot extracts the client, scope, amount (converts lakh/crore), dates and
  payment terms, shows a summary, and proposes a "Create this deal" button.
  NOTHING is created until the user confirms — and Copilot never invents an
  amount that wasn't stated.
- Protection Check on every deal: flags risky wording (e.g. "as per site
  requirement", unlimited revisions, pay-when-paid, retention without a
  release date, contradicting payment figures) and missing protections (no
  advance, no balance timeline, no revision limit, no exclusions, no
  late-payment consequence). One tap suggests the missing term lines and can
  add them to a Pending deal. It does not give legal advice.
- Payment Chaser: drafts follow-up messages for unpaid invoices in five tones
  including Hinglish, using only the real invoice facts. The user copies and
  sends it themselves — DealInSec never messages a client directly.
- Daily briefing and Money Radar (overdue / due this week / ready to invoice)
  are COMPUTED from the user's records, never AI-generated. The rule across
  all AI features: numbers are computed, AI only writes words, and every
  action needs the user's confirmation.
