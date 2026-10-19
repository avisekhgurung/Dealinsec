# India-market copy pass: progress checklist (19 October 2026)

Read this with `docs/india-market-copy-audit.md`, which holds the reasons, the claims not published and the product gaps.

Nothing here is committed, pushed or deployed. No migration was run and no production data was touched.

## Milestones

| # | Milestone | State | Notes |
|---|---|---|---|
| 1 | Audit and mapping | Done | The research report wasn't found; the brief's copy was used, and every claim was checked against the code |
| 2 | Shared terminology | Done | Tagline, one-liner, supporting line in product-facts. Coworker roles and run status labels in shared/ai-league.ts. Log in / Log out wording |
| 3 | Marketing website | Done | Homepage hero and sections, header, footer, pricing preview, FAQ, crawler copy, index.html meta. New /crm-for-freelancers. Brief H1s on the quotation, invoice and AI coworker pages. GST over-claims removed |
| 4 | Auth and onboarding | Done | Log in, sign up, forgot and reset copy. Tested error helper. Onboarding headings, labels and completion toast. Browser-verified on the local DB |
| 5 | Core application | Done | Dashboard, leads, deals, create/edit deal, import, quotations, quote preview, agreements, invoices, invoice detail ("Prepare payment reminder") |
| 6 | AI League | Done | Statuses, approvals wording, Mika "copy and send yourself", Zee "Today's business briefing", AI disclaimer, Agent mode, Client Radar |
| 7 | Supporting screens | Done | Settings ("Business details", honest invite and Gmail copy), profile, invite acceptance, 404, notification bell, install prompt, payment result, plan page |
| 8 | India consistency | Partly done | Money goes through the shared formatters (₹1,25,000 verified). Some date helpers are local (audit §5.12) |
| 9 | SEO and final QA | Done | Unique title, meta and H1 on changed pages. Tests, tsc and build pass. Browser pass on the main screens |

## Files changed (main ones)

**Positioning**
- `shared/product-facts.ts`, `shared/landing-faqs.ts`
- `client/src/components/dealinsec-logo.tsx`
- `client/public/brand/dealinsec-lockup*.svg`, `script/brand-svgs.py`
- `server/emails.ts`, `ai-knowledge/product.md`

**Marketing**
- `client/src/components/landing-redesign.tsx`, `client/src/pages/landing.tsx`, `client/index.html`
- `server/landing-seo.ts`, `server/category-pages.ts` (new CRM page, H1s, GST fixes)
- `server/llms.ts`, `shared/ssr-paths.ts`, `server/comparison-pages.ts`, `server/blog.ts`, `server/tools/layout.ts`, `client/src/pages/pitch.tsx`

**Auth and onboarding**
- `client/src/pages/auth.tsx`, `forgot-password.tsx`, `reset-password.tsx`, `onboarding.tsx`
- New `client/src/lib/auth-copy.ts` and its test

**Core screens**
- `client/src/pages/dashboard.tsx`, `leads.tsx`, `lead-details.tsx`, `deals.tsx`, `deal-details.tsx`, `create-deal.tsx`, `edit-deal.tsx`, `deals-import.tsx`
- `quotations.tsx`, `quote-preview.tsx`, `contracts.tsx`, `contract-details.tsx`, `contract-confirmation.tsx`
- `billing.tsx`, `brand-invoice-new.tsx`, `brand-invoice-details.tsx`
- `shared/whatsapp-share.ts` (invoice reminder template only)
- `components/load-error.tsx`, `data-table`, `detail-states`, `leads/follow-ups.tsx`, `leads/lead-import-dialog.tsx`

**AI**
- `client/src/pages/ai-league.tsx`, `agent.tsx`, `outbound.tsx`
- `components/ai-league/*`, `components/agent/*`, `components/outbound/*`
- `client/src/lib/ai-league.ts`, `client/src/hooks/use-agent.ts`
- `shared/ai-league.ts` (roles and labels), `server/ai-league/service.ts` ("Report scheduled")

**Settings**
- `client/src/pages/settings.tsx`, `profile.tsx`, `accept-invite.tsx`, `not-found.tsx`, `pricing.tsx`
- `components/settings/*`, `notification-bell.tsx`, `install-prompt.tsx`, `feedback-card.tsx`, `payment-result.tsx`, `desktop-topnav.tsx`
- `shared/settings-tabs.ts` (label only)

**Tests updated (copy pins only)**
- `server/landing-copy.test.ts`, `server/seo.test.ts` (plus a new /crm-for-freelancers block)
- `server/copilot/ask-dealinsec.test.ts`, `server/ai-league/service.test.ts`

## Not done in this pass (see audit §5)
- Clients, Tasks, Approvals and Reports pages.
- Session-expiry handling in the fetch layer.
- An i18n framework or Language setting.
- Quotation expiry.
- Mobile create buttons for agreements and invoices.
- Shared date-formatting refactor.
- **Decision needed:** tax lines outside India vs product-facts.
- **Decision needed:** renaming "Client Radar" to "Find clients" in the navigation, together with the pricing copy.
- The dead auth-modal markup in `landing.tsx` (unused) was not reworded.
