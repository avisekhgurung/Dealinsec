# DealInSec

> Your AI team finds clients for you.

[![Live](https://img.shields.io/badge/live-www.dealinsec.com-0E8C5A?style=flat-square)](https://www.dealinsec.com)
[![Stack](https://img.shields.io/badge/stack-React%20%2B%20Express%20%2B%20Postgres-0F172A?style=flat-square)](#tech-stack)
[![License](https://img.shields.io/badge/license-Proprietary-64748B?style=flat-square)]()

---

## What DealInSec is

DealInSec is an AI team that **finds clients** for freelancers, consultants and small service agencies, built first for
India. You describe who you want to work with; it researches companies with evidence, drafts outreach you approve, and
keeps your leads and follow-ups in one place.

```
Describe your ideal client  →  AI researches companies (with sources)
                            →  You approve the first message and send it yourself
                            →  Leads, replies and follow-ups on one record
```

Finding clients is the product. Records for work you win — deal, quotation, agreement, invoice, payment tracking — exist
behind that and share the same client record.

## Who it is for

Freelancers and solo consultants, and small B2B service agencies of roughly 1–10 people: web development and software
services, digital marketing, SEO and growth, AI automation, content and lead generation. Creators who do paid brand
collaborations can use it too, as a secondary audience. It is **not** built for large enterprise sales teams.

## What it does

| Capability | Description |
|---|---|
| **Client Radar** | Describe the companies you want and the countries or cities to look in. It searches the web, reads each company's own website against your profile, scores the fit with reasons, and surfaces recent **dated** signals (hiring, launches, expansion) with their sources. Named decision makers are shown where they are public. |
| **Local business mode** | Lists businesses in a city from Google Maps (for example dentists in Siliguri) so you can pick which listed websites to research. Listings are shown for that search and not stored — only place IDs are kept. |
| **The Nest — AI coworkers** | Nibo 🔎 researches companies and saves qualified ones to Leads with their evidence; Mika 💌 drafts first messages and follow-ups from verified facts; Zee 🌱 briefs you on what is due from your own records. Tasks run in the background and can be scheduled. They ask before anything that spends an allowance or changes a record. |
| **Outreach drafts with approval** | AI drafts a first message from verified facts, or you write your own. You edit and approve the exact text and send it yourself from your own email, WhatsApp, LinkedIn, Instagram, X or Messenger. A do-not-contact list is checked first. |
| **Leads pipeline** | Stages, next steps, follow-up dates, recorded facts with their sources, a lead score and manual reply tracking. |
| **Deal records** | For work you win: a deal with engagement model, scope and fee, a quotation the client can accept online, an agreement they can sign online (electronic acceptance with an audit record), invoices drawn from that agreement, and payment status. |
| **Credit top-ups** | When a monthly allowance runs out, extra search or draft credits can be bought in packs. Plan allowance is spent first, then purchased credits. |

## What it does not do

Stated plainly, because it matters more than the feature list:

- **It does not send anything on its own.** Every message — first touch and follow-up — is approved as exact text by a
  person and sent by them from their own account. There is no automatic sending, no scheduled reminders, no campaigns
  that go out by themselves.
- **It is not a contact database.** Contact details appear only where a company publishes them or a connected provider
  returns them. They are not always available and are never invented or resold.
- **It does not guarantee clients, replies, meetings or revenue.** No honest tool can.
- **It does not read or classify email with AI.** Where a Gmail connection is enabled, replies are sorted by fixed
  rules only; Gmail content is never sent to an AI model.
- **It does not collect or move your clients' money.** Clients pay you directly; DealInSec records the status.
- **It is not a marketplace or a job board.** There are no briefs to bid on and no deals to be matched with.
- **Inferences are labelled as inferences.** Where the AI reads a possible opportunity into what it found, that is shown
  as a guess with its source, never as a verified fact. Unknowns stay unknown.
- **Not included:** time tracking, a client portal, accounting or expense tracking, meeting scheduling, automated email
  marketing, Outlook, and integrations with other CRMs.
- **Agreements are electronic acceptance** with an audit record of who signed and when — not certificate-based digital
  signatures. DealInSec gives no legal or tax advice.

## Pricing

- **Free** — permanent, no card, in every country: 3 Client Radar searches every 30 days (up to 10 companies each),
  5 AI outreach drafts, the leads pipeline, the AI coworkers, and 4 deals a month with their quotations.
- **Pro — ₹299/month** in India: 20 Client Radar searches every 30 days, 100 AI outreach drafts, unlimited deals,
  agreements signed online, invoices, payment tracking and 5 team members. Paid once a month through Razorpay
  (UPI, cards, netbanking); **it does not auto-renew** — you pay again to extend, or the workspace returns to Free.
- **Credit packs** for extra capacity, from ₹49 (5 searches or 25 drafts) up to ₹349 (50 searches) and ₹299
  (250 drafts). Pack quantities and prices are database-driven.
- **There is no free trial.** New accounts start on the permanent free plan. There are no unlimited plans, and no
  platform fee or commission on your deal value.

Paid plans can currently be bought by workspaces in India only; the free plan is open everywhere.

## Note on out-of-date descriptions

Third-party listings and older copies of this README describe DealInSec as a "deal-management OS" or "quote-to-cash
platform" priced per signed contract, at ₹199/month, or with a user count. **Those descriptions are out of date.**
The product is a client-finding tool; Pro is ₹299/month; there is no pay-per-contract credit model; and this project
publishes no user numbers, ratings or customer logos.

The authoritative, machine-readable description of what works today — including every limit — is
[`shared/product-facts.ts`](shared/product-facts.ts), which also generates
[www.dealinsec.com/llms.txt](https://www.dealinsec.com/llms.txt). Prefer either over any summary.

---

## Tech stack

### Frontend
- **React** + **TypeScript** + **Vite** — SPA with code-splitting
- **Wouter** — lightweight client-side routing
- **TanStack React Query** — server state, caching and mutations
- **Tailwind CSS** + **shadcn/ui** — design system on Radix primitives
- **Framer Motion** — micro-interactions
- **react-hook-form** + **Zod** — form state and validation
- Self-hosted **Source Sans 3** (no webfont CDN)

### Backend
- **Node.js** + **Express** — REST API under `/api/*`, plus server-rendered marketing, blog, tool and audience pages
- **Drizzle ORM** + **PostgreSQL** — type-safe schema; migrations run as explicit scripts, never on boot
- **Passport.js** — email/password + Google OAuth
- **express-session** with a Postgres-backed store

### Infrastructure & integrations
- **MilesWeb VPS (Mumbai)** — the app and its PostgreSQL run on one box behind **nginx**, with Let's Encrypt TLS
- **Razorpay** — UPI, cards and netbanking for Pro and credit packs (orders verified server-side, webhooks reconciled)
- **ImageKit** — file storage and CDN for uploads, signatures and document proofs
- **Google Places** — local business listings for Client Radar's local mode
- **Google Cloud Console** — OAuth 2.0 for Sign in with Google
- LLM providers behind one router, with a per-workspace spend ceiling enforced on every metered call

## Project structure

```
client/src/             # React frontend
├─ pages/               # Route-level components (landing, dashboard, leads, outbound, wallet, …)
├─ components/          # Reusable UI, Client Radar and The Nest views
├─ components/ui/       # shadcn/ui primitives
├─ lib/                 # API client, query client, analytics, utils
└─ hooks/               # Auth, toast, viewport hooks

server/                 # Express backend
├─ index.ts             # Bootstrap, security headers, robots.txt, sitemap.xml, llms.txt, route order
├─ outbound/            # Client Radar: search, page reading, scoring, evidence, allowances
├─ ai-league/           # The Nest: Nibo, Mika and Zee, their tasks and scheduling
├─ outreach-studio/     # Draft composition across the manual channels
├─ leads/ campaigns/    # Pipeline, follow-ups and review flows
├─ billing/             # Plans, credit ledger, packs, Razorpay orders and events
├─ llm/                 # Provider router, tracing and the workspace spend ceiling
├─ blog.ts              # Server-rendered guides
├─ category-pages.ts    # Commercial and audience landing pages
├─ landing-seo.ts       # Crawler copy for the SPA homepage
└─ site-head.ts         # Per-page title, description, canonical and structured data

shared/                 # Cross-runtime code (server + client)
├─ product-facts.ts     # THE source of truth for public product claims
├─ outbound-plans.ts    # Allowances and the rolling window
├─ billing-config.ts    # Credit packs and configurable limits
├─ flags.ts             # Product-shape switches
└─ schema.ts            # Drizzle tables + Zod schemas

script/                 # Operator scripts: migrations, grants, deploy
```

---

## Getting started

### Prerequisites
- **Node.js** 20+
- **npm** 9+
- **PostgreSQL** 14+

### Setup

```bash
# 1. Clone
git clone https://github.com/avisekhgurung/Dealinsec.git
cd Dealinsec

# 2. Install dependencies
npm install

# 3. Environment variables
cp .env.example .env
# Fill in DATABASE_URL, SESSION_SECRET, IMAGEKIT_*, GOOGLE_*, RAZORPAY_* — see Configuration

# 4. Start the dev server (hot reload)
npm run dev
```

> **Never point a local run at the production database.** Always set `DATABASE_URL` to your own database.
> Schema changes are applied by explicit scripts in `script/`, never automatically at boot.

### Available scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Express + Vite dev server with HMR |
| `npm run build` | Production build (client → `dist/public`, server → `dist/index.cjs`, with pre-compressed assets) |
| `npm run start` | Run the production bundle |
| `npm run check` | TypeScript type-check (`tsc --noEmit`) |
| `npx vitest run` | Test suite — run it **without** `DATABASE_URL` set |

Do not run `tsc` and `vitest` at the same time.

## Configuration

Environment variables (`.env`):

```dotenv
# Runtime
NODE_ENV=development
PORT=5000
APP_URL=http://localhost:5000           # Public URL in production

# Database — your own, never production
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# Session
SESSION_SECRET=<long random string>

# ImageKit (file storage)
IMAGEKIT_PUBLIC_KEY=public_xxxxx
IMAGEKIT_PRIVATE_KEY=private_xxxxx
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/yourusername
```

Payment, LLM provider, Google OAuth and Google Places keys are read from the same file; the server starts without them
and reports each integration as unconfigured rather than failing.

---

## License

Proprietary. All rights reserved.

Made by [Avisekh Gurung](https://github.com/avisekhgurung), an independent founder in Darjeeling, India.
