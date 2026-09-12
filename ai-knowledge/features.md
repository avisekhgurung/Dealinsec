# Feature highlights

- Dashboard: greeting, animated KPI funnel (Deals→Quotations→Agreements→Paid
  Invoices→Pipeline value), deal status split, Earned/Pending, deliverables
  chart, recent deals, trial countdown.
- Deal types match freelance work (Design, Development, Writing, Marketing,
  Video & Photo, Consulting, Custom), with picklists for the kind of work and
  how you bill it (per project, milestone, hourly, monthly retainer, per
  word/article/design) plus an "Other (specify)" free-text option.
- Quotations: versioned, professional documents; print/PDF from the browser.
- Agreements: standard + custom terms, billing details collected just-in-time,
  signature image applied, signed-proof upload. Electronic acceptance with an
  audit record — not a Digital Signature Certificate or Aadhaar eSign.
- Invoices record the agreed contract value and print PAN/GSTIN when set. They
  are NOT tax invoices under Rule 46 of the CGST Rules — DealInSec does not
  compute CGST/SGST/IGST on them, and the invoice says so in its footer. The
  free browser tool at /tools/gst-invoice DOES compute GST; the app does not.
  Call them GST-ready professional invoices, never "GST invoices",
  "GST-compliant" or Rule-46 tax invoices — they carry your PAN/GSTIN but no
  CGST/SGST/IGST computation.
- Invoices: single or split, attachments (e.g. GST invoice, TDS certificate),
  payment status tracking.
- Team (optional): invite an assistant or partner by email or join link, roles
  with a permission matrix, activity log of who did what.
- Free public tools at /tools (invoice/GST/quotation generators) for marketing.
- PWA install, dark mode, keyboard shortcut [ to collapse the sidebar.

## Copilot AI (in-app assistant)
- Create a deal from a pasted WhatsApp chat, email thread or a plain request:
  Copilot extracts the client, scope, amount (converts lakh/crore), dates and
  payment terms, shows a summary, and proposes a "Create this deal" button.
  NOTHING is created until the user confirms — and Copilot never invents an
  amount that wasn't stated.
- Protection Check on every deal: flags risky wording (e.g. unlimited
  revisions, "pay when our client pays", "to be decided later", contradicting
  payment figures) and missing protections (no advance, no balance timeline,
  no revision limit, no exclusions, no late-payment consequence). One tap
  suggests the missing term lines and can add them to a Pending deal. It does
  not give legal advice.
- Payment Chaser: drafts follow-up messages for unpaid invoices in five tones
  including Hinglish, using only the real invoice facts. The user copies and
  sends it themselves — DealInSec never messages a client directly.
- Daily briefing and Money Radar (overdue / due this week / ready to invoice)
  are COMPUTED from the user's records, never AI-generated. The rule across
  all AI features: numbers are computed, AI only writes words, and every
  action needs the user's confirmation.
