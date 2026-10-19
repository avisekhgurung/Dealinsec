# India-market copy audit (19 October 2026)

This audit records the India-market copy and UX pass. It lists:
- what exists in the product;
- what changed;
- which suggested claims were **not** published, and why.

It was written against the repository, not against the research report.

**Source note.** The brief names a Perplexity report, "DealInSec India Market Copy & Repositioning Report", as the primary specification. It was **not found**: I searched the repository and this Mac by file name and by contents. The proposed copy and rules written into the brief itself were used as the specification. Every feature claim was checked against the code and `shared/product-facts.ts` (the single source for capability and price claims).

Classification key: **C** copy only · **N** navigation / IA · **S** SEO / metadata · **U** UX improvement · **P** product-dependent (needs a feature that doesn't exist) · **L** legal, tax, pricing or security verification required.

## 1. What the repository is

### Stack and structure
- **Client:** React, Vite, wouter, TanStack Query, Tailwind and shadcn/ui, in `client/src`.
- **Server:** Express, Drizzle and Postgres. Production and development share one Neon database.
- **Public site:**
  - The SPA homepage is `client/src/pages/landing.tsx` plus `components/landing-redesign.tsx`.
  - The crawler fallback is `server/landing-seo.ts`.
  - The other indexable pages are rendered by Express in `server/category-pages.ts`, `comparison-pages.ts`, `blog.ts` and `tools/*`, and registered in `shared/ssr-paths.ts`.
- **Single sources:**
  - `shared/product-facts.ts`: tagline, positioning, capabilities, prices, NEVER_CLAIM.
  - `shared/landing-faqs.ts`: the FAQ accordion and the FAQPage JSON-LD.
  - `shared/nav-model.ts`: signed-in navigation.
  - `shared/ai-league.ts`: coworker identities and status labels.
- **Formatting:** money goes through `shared/money.ts`, which uses the workspace currency (`₹` with Indian grouping for INR; 50 currencies supported). Dates go through `client/src/lib/format.ts`.
- **Localization:** there is no i18n framework, and none was added. The copy is English (India). Workspaces can use other countries and currencies, so ₹ is never hard-coded where the workspace currency applies.
- **Commands:** type check `npm run check` (tsc), tests `npm test` (vitest), build `npm run build`. There is no lint script.

### Signed-in routes
- `/dashboard` (Home)
- `/ai-league[/:bot]` (Nibo, Mika, Zee)
- `/agent/:id?` (Agent mode, "Ask DealInSec")
- `/outbound` (Client Radar)
- `/leads`, `/leads/:id`
- `/deals`, `/deals/new`, `/deals/import`, `/deals/:id`, `/deals/:id/edit`, `/deals/:id/quote`, `/deals/:id/contract`
- `/quotations`
- `/contracts`, `/contracts/:id` (Agreements)
- `/invoices`, `/brand-invoices/new`, `/brand-invoices/:id`
- `/profile`, `/settings` (tabs: Business details, Team, Integrations, Plan & billing, Preferences, Activity log)
- `/pricing`

Pages in the brief's suggested navigation that **do not exist**: Clients, Tasks, Approvals, Activity, Reports and Payments. (**P**)
- Clients are recorded on leads and deals.
- Tasks are lead next steps and follow-ups.
- Approvals live inside AI League and Agent mode.
- The activity log is a Settings tab.
- Payments are statuses inside invoices.

## 2. Verified capabilities, and the statuses the UI may use

| Area | What exists (verified in code / product-facts) | Allowed wording | Not allowed |
|---|---|---|---|
| Quotations | Generated from the deal; versioned; shared link; the client can **accept online**; print/PDF; "Subject to applicable taxes" | Shared, Accepted | GST calculated, expiring/expired (no expiry tracking), "sent" by DealInSec |
| Agreements (Pro) | Online signing link with an audit record; electronic acceptance, not a certified digital signature | Signed (when the record says so) | Certified/legally guaranteed signature, legal advice |
| Invoices (Pro) | Single or split; from the agreement; the user marks paid; no tax calculation; not GST tax invoices | Paid, Pending, Overdue | Payment collection, payment links, partial payments, GST invoice |
| Payment follow-ups | AI drafts; the user copies and sends | "Prepare payment reminder" | "Reminder sent", automatic reminders |
| Nibo | Client Radar search; checks companies' own websites; saves qualified ones to Leads with sources; campaigns | Finds and researches potential clients | Guaranteed leads, verified contacts |
| Mika | Drafts first messages; nothing sent | Prepares drafts you approve and send yourself | Send, delivered, follow-up sequences |
| Zee | Briefs from the workspace's own records | Today's business briefing | Bank-account access, invented totals |
| Sign-up | Free plan at ₹0, permanent, no card; Google sign-in exists | "Get started free", "No credit card required" | Trial (removed 18 Oct) |
| Password | Minimum 6 characters (server); reset link valid 30 minutes; reset logs you in; forgot-password response is the same whether or not the account exists | "Use at least 6 characters." | Requirements not enforced |
| Pro | ₹199 a month, India only, paid once a month, no auto-renewal | Plan & billing | "Subscription" (implies auto-renewal) |

## 3. Changes made, by area

### Positioning (C, S)
- `shared/product-facts.ts`:
  - TAGLINE is now "Find clients. Win deals. Get paid."
  - ONE_LINER is now the "simple business workspace … built first for India" sentence.
  - New SUPPORTING_LINE.
- These feed the assistants' knowledge, `/llms.txt`, the JSON-LD and the crawler copy.
- The same tagline is now in:
  - the logo slogan (`dealinsec-logo.tsx`);
  - the brand lockup SVGs (regenerated with `script/brand-svgs.py`);
  - the email footer;
  - `ai-knowledge/product.md`;
  - the tools and category footers.

### Homepage (C, S, U)
- **Hero:**
  - Eyebrow: "For freelancers and service providers in India".
  - H1: "Find clients. Win deals. Get paid."
  - Subheading: the brief's text, with "Manage clients" changed to "Track leads and deals". There is no client directory.
  - CTAs: "Get started free" and "See how it works".
  - "No credit card required", which is verified.
- **Sections:**
  - "One workspace for the client journey", with Find opportunities / Manage leads and deals / Send clear quotations / Prepare agreements / Invoices and payment follow-ups.
  - "Meet Nibo, Mika and Zee, your AI coworkers": Opportunity Scout, Deal Closer, Business Guardian, with the AI disclaimer.
  - "Built for people who sell services": web developers, designers, marketers/SEO and consultants. Small agencies (including AI automation) stay named as the secondary audience.
  - Pricing: "Start free. Upgrade when you need more."
- **Header:** Product ▾ · AI coworkers · Pricing · Resources ▾ · Log in · Get started free. When logged in, the link reads "Home", not "Dashboard".
- **Footer:** adds AI coworkers and CRM for freelancers.
- **Metadata:** `client/index.html` title "DealInSec: Find Clients, Win Deals, Get Paid", plus a new meta and OG description.
- **Crawler copy** (`server/landing-seo.ts`): matches the page, adds the CRM page link, and uses the invoice H1 for the money section.
- **FAQ** (`shared/landing-faqs.ts`): "What is DealInSec?" and "Who is it for?" are rewritten freelancer-first.

### Public SEO pages (S, C, L)
- **New:** `/crm-for-freelancers`, titled "CRM for Freelancers in India | Manage Clients & Deals" with the brief's meta description.
  - Built only from shipped features: lead stages, next steps and follow-up dates, deals, Today list, CSV import, quotations accepted online.
  - Says plainly that there is no separate client directory, no sending for you, and that Gmail is limited.
  - Registered in `ssr-paths`, the sitemap, `llms.txt`, the homepage crawler links, the header Resources menu and the footer.
  - Tested in `server/seo.test.ts`.
- **H1s from the brief:**
  - `/quotation-software`: "Send clear quotations that help you win work".
  - `/invoice-management`: "Create invoices. Track payments. Follow up professionally."
  - `/ai-coworkers`: "AI coworkers for your business workflow".
- **Over-claims removed (L):**
  - `/quotation-software` said "GST-ready", "itemised quotes with GST", "Math & GST computed", and answered "Yes" to "Does it handle GST on quotations?". Quotations don't calculate GST; that answer is now honest and points to the free GST tool.
  - "converts … automatically" became "create the agreement and the invoice from the same deal".
  - "Quotations … expiring" became "not accepted yet": there is no expiry tracking.
  - `/freelancer-invoice-software` table: "GST-ready" became "(in-app invoices are not GST tax invoices)".
- **Wording:**
  - Server-page CTAs now say "Get started free →".
  - The `/about` and tools footers now say "win deals".

### Log in, sign up, password recovery (C, U)
- **Sign up:**
  - "Create your free account", with the description "…No credit card required."
  - Labels: Email address, Create password, and the hint "Use at least 6 characters." (the real rule, linked with aria-describedby).
  - Button: "Create account".
  - Terms line: "By creating an account, you agree to our Terms of Service and Privacy Policy."
- **Log in:**
  - "Welcome back" / "Log in to manage your clients, deals and payments."
  - Button: "Log in". The switch link reads "New to DealInSec? Create a free account".
- **Errors:**
  - The toasts used to show the raw `"401: {json}"` text.
  - The new helper `client/src/lib/auth-copy.ts` (tested) shows instead:
    - "That email or password doesn't match an account. Please try again." for a wrong email or password; it's the same message whichever was wrong;
    - "Couldn't reach DealInSec. Check your internet connection and try again." for a network failure;
    - the server's own sentence for a 400 or 429;
    - a plain message for a 5xx.
  - Browser-verified on the local database.
- **Forgot and reset password:**
  - "Enter your registered email address and we'll send you a reset link."
  - Success: "Your password has been updated. You're now logged in." Reset really logs you in, so the brief's "You can now log in" would have been inaccurate.
  - "Back to log in".
- **Not added:** phone/OTP/WhatsApp login, and a "session expired" message. Nothing maps a 401 to that message today; adding it would mean changing global fetch logic, so it's left as a recommendation. (**P/U**)

### Onboarding (C)
- **Step names:** Your work · About you · Country & billing.
- **Headings:**
  - "What would you like to do first?", with the hint "This helps DealInSec show you the right tools from day one."
  - "Let's set up your workspace".
  - "Country, currency and billing".
- **Labels:** Your name, Phone number, Business name, Billing address.
- **Completion toast:** "You're all set, {name}" / "Your workspace is ready…".
- **Error toast:** "Couldn't save your details" / "Check your internet connection and try again."
- **Schema:** no fields or steps were added. The existing goal options (Find new clients / Manage active deals / Send quotations and get paid) already match the brief.

### Core app screens, AI League, Agent mode, Client Radar, Settings
Done by focused passes; per-file details are in `docs/india-market-copy-progress.md`. Summary:
- **AI task statuses** are now one vocabulary, in both client and server (`shared/ai-league.ts` RUN_STATUS_LABEL): Queued, Scheduled, In progress, Completed, Completed with limitations, Failed, Cancelled, plus "Waiting for your approval" for approvals.
  - "Report ready" (shown while a report was still held back) is now "Report scheduled".
- **Coworker roles:** Opportunity Scout, Deal Closer, Business Guardian. Persona prompts read these; the pinned test was updated.
- **Mika:** wherever drafts are approved, the UI says nothing is sent and you copy the text and send it yourself.
  - "Approved. Send it from the lead page." used to imply DealInSec sends; it no longer does.
- **Zee:** the briefing is headed "Today's business briefing", with the freshness line. Over-claims such as "everything looks protected" and "watching these for you" were removed: nothing monitors in the background.
- **AI disclaimer** ("AI results may be incomplete or inaccurate…") appears once per results or report surface.
- **Fake time estimates** were removed ("About a minute", "a few minutes").
- **Settings:**
  - "Business profile" is now "Business details".
  - The invite toast no longer claims delivery: the email is fire-and-forget.
  - Gmail is described as limited early access, with sending not switched on.
  - "Plan & billing" was kept, because Pro doesn't auto-renew.

## 4. Claims deliberately NOT published

- **GST:** GST compliance, GST calculation on quotations or invoices, and "GST-ready". The free GST invoice generator tool keeps its own GST wording, because it really computes GST.
- **Payments:** payment collection, payment links, partial payments, payment confirmation by DealInSec.
- **Sending:** automatic sending of email, WhatsApp, follow-ups or reminders.
- **Mika:** "sends" or "delivered".
- **Results:** guaranteed clients, leads, replies or meetings, or verified contact details.
- **Signatures:** certified or legally guaranteed signatures, or legal advice.
- **Pro:** a Pro trial, auto-renewing "subscription" wording, or annual plans.
- **Company and legal details:** company legal name, address, GSTIN, phone or WhatsApp support number. Only the existing support@dealinsec.com is used.
- **Trust claims:** security certifications, data residency, retention periods or AI-training statements beyond the existing policy pages.
- **Social proof:** testimonials, customer counts, ratings or logos.
- **Search data:** search volumes or ranking promises.

## 5. Product-dependent items (need development, not copy)

1. **Clients page**, a directory built from deals and leads. The brief's "Clients" nav, "Add client" and the client search/no-results copy depend on it.
2. **Tasks page:** a cross-lead list of next steps and follow-ups. Today these are per lead plus the dashboard's Today list.
3. **Approvals page:** one inbox for AI League and Agent approvals. Today they're inside each surface.
4. **Reports:** there is no reports page; AI League run reports export CSV and Markdown.
5. **Session-expiry message:** needs 401 handling in `lib/queryClient.ts`.
6. **Language setting / Hindi:** there is no i18n framework (not wanted in this pass).
7. **Quotation expiry tracking:** quotations have a validity date in their terms, but no Expired status.
8. **Deals have no won/lost actions.** Their states are Pending, Active and Completed. Won and lost exist on leads: "Mark won and create deal" and "Mark {company} as lost?". The deal page uses "Deal marked as completed. Congratulations!".
9. **No "Add at least one item" quotation validation exists**, because quotations are generated from the deal.
10. **Mobile "New agreement" / "New invoice" buttons** are hidden below `lg`. Adding them would change behaviour.
11. **Tax lines outside India:** `brand-invoice-new.tsx` offers optional tax lines for workspaces outside India and says DealInSec calculates the amount. `product-facts.ts` says "App invoices don't calculate tax". **The founder needs to decide which is right**, and one of them must change. (**L**)
12. **Date formatting:** several list pages use local `toLocaleDateString` helpers instead of the shared `formatDate`. Date-only values can show a day early for users west of UTC. A refactor is recommended; no copy change is needed.
13. **Deliverable "done" ticks** on the deal page are saved only in the browser (`localStorage`), and the page doesn't say so.
14. **Server status names are aligned, but historic run events** keep the words they were written with.

## 6. Decisions recorded

- **Navigation kept as is:** Home · AI League · Client Radar · Leads · Deals · Quotations · Agreements · Invoices. The phone bar is Home · AI League · Outbound · Leads · More.
  - The brief's Money/AI Workspace grouping would rename or move items that pricing, product facts and tests use ("Client Radar"). It could also bring back the 1024–1535 px desktop overflow fixed on 19 October.
  - The founder's earlier decision was to keep one-click tabs.
  - Recommendation for a later pass: rename the "Client Radar" tab to "Find clients" together with the pricing copy.
- **"AI League"** stays the coworkers' area name: it's a brand the founder chose. The page now describes itself as "Your AI coworkers".
- **"Log in"/"Log out"** replace "Sign in"/"Sign out" in the auth pages, landing header and profile.
- **Audience:** freelancers first. Small agencies, including AI automation, stay named as the secondary audience. Creators keep their existing pages.
