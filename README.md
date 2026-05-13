# DealInSec

> The deal-management OS for every service business. One workflow for creators, freelancers, agencies, consultants, and vendors — built for India.

[![Live](https://img.shields.io/badge/live-www.dealinsec.com-0E8C5A?style=flat-square)](https://www.dealinsec.com)
[![Stack](https://img.shields.io/badge/stack-React%20%2B%20Express%20%2B%20Postgres-0F172A?style=flat-square)](#tech-stack)
[![License](https://img.shields.io/badge/license-Proprietary-64748B?style=flat-square)]()

---

## Overview

DealInSec is a SaaS platform that replaces scattered tools (WhatsApp, email, spreadsheets, Word contracts) with a single pipeline that follows every paid client or brand deal end-to-end:

```
Deal  →  Quotation  →  Contract  →  Invoice  →  Insights
```

It is engineered for India's deal-led service economy — creators, freelancers, agencies, consultants, and service vendors — with native support for GST invoicing, UPI/PayU/Stripe payments, and PAN/IFSC banking workflows.

**Status:** MVP live with 50+ early users across creator, freelance, and service-vendor verticals.

---

## Key Features

| Feature | Description |
|---|---|
| **Deal Management** | Centralised pipeline for every client or brand opportunity with deliverables, deadlines, and status tracking. |
| **Multi-Vertical Deal Types** | Templated taxonomies for Creator, Freelance, Consulting, Service Vendor, and Custom deals — 400+ predefined categories with free-form fallback. |
| **Instant Quotations** | Branded, GST-ready quotes generated in under 60 seconds. Standard T&Cs prefilled per vertical. |
| **Legal Agreements** | Auto-generated, e-signable contracts with exclusivity, scope, and cancellation clauses. Counter-signed proof upload. |
| **Smart Invoices** | Advance + final splits, due-date reminders, payment status tracking, downloadable PDFs. |
| **Insights Dashboard** | Real-time earnings, contract value, brand/client performance, tax-ready P&L. |
| **Credit-Based Pricing** | Pay-per-deal model (1 credit = ₹299 per signed contract). Free pipeline, free quotations, free invoices. |
| **Referral Program** | Built-in referral codes; both sides earn free credits. |
| **Brand-Side Portal** | Brands and SMB clients see their deals, contracts, and invoices in a dedicated workspace. |
| **Responsive Shell** | Mobile-first bottom nav for phones and tablets; SaaS-grade sidebar on desktop. |

---

## Tech Stack

### Frontend
- **React** + **TypeScript** + **Vite** — SPA with code-splitting
- **Wouter** — lightweight client-side routing
- **TanStack React Query** — server state, caching, and mutations
- **Tailwind CSS** + **shadcn/ui** — design system on Radix primitives
- **Framer Motion** — micro-interactions
- **react-hook-form** + **Zod** — form state and validation

### Backend
- **Node.js** + **Express** — REST API under `/api/*`
- **Drizzle ORM** + **PostgreSQL** — type-safe schema, migrations via `drizzle-kit`
- **Passport.js** — email/password + Google OAuth strategies
- **express-session** with Postgres-backed session store
- **Multer** — multipart upload handling

### Infrastructure & Integrations
- **Render** — application hosting (Web Service)
- **Neon** — managed PostgreSQL (serverless, free tier)
- **ImageKit** — image/PDF storage + global CDN (profile photos, signatures, contract proofs)
- **Cloudflare** — DNS + SSL + edge proxy
- **Stripe** — international card payments for platform-fee invoices
- **PayU** — Indian payment gateway for credit purchases
- **Google Cloud Console** — OAuth 2.0 for Sign in with Google

---

## Architecture

```
                ┌─────────────────────────────────────────────┐
                │           Cloudflare (DNS + SSL)             │
                └──────────────────────┬──────────────────────┘
                                       │
                  ┌────────────────────▼─────────────────────┐
                  │   Render — Express Web Service (Node)     │
                  │   • API routes  • Static client build     │
                  │   • Session middleware  • Auth (Passport) │
                  └─────┬───────────┬───────────┬─────────────┘
                        │           │           │
              ┌─────────▼──┐   ┌────▼─────┐   ┌─▼───────────┐
              │  Neon (PG) │   │ ImageKit │   │ Stripe/PayU │
              │  Drizzle   │   │  Files   │   │  Payments    │
              └────────────┘   └──────────┘   └──────────────┘
```

---

## Project Structure

```
client/src/             # React frontend
├─ pages/               # Route-level components (landing, dashboard, deals, etc.)
├─ components/          # Reusable UI (sidebar, bottom-nav, combobox, logo)
├─ components/ui/       # shadcn/ui primitives (button, dialog, popover, …)
├─ lib/                 # API client, query client, utils
└─ hooks/               # Auth, toast, viewport hooks

server/                 # Express backend
├─ index.ts             # Bootstrap, middleware, OAuth wiring
├─ routes.ts            # REST endpoints (deals, contracts, invoices, payments)
├─ storage.ts           # Data access layer (Drizzle queries)
├─ db.ts                # Postgres connection
├─ auth.ts              # Session config + local auth
├─ googleAuth.ts        # Google OAuth strategy
├─ stripeClient.ts      # Stripe SDK wrapper
├─ imagekitClient.ts    # ImageKit upload helper
└─ webhookHandlers.ts   # Stripe + PayU webhook callbacks

shared/                 # Cross-runtime code (server + client)
├─ schema.ts            # Drizzle table definitions + Zod insert/select schemas
└─ dealTypeTaxonomy.ts  # 400+ deal categories per vertical
```

---

## Data Model

Core entities (see [`shared/schema.ts`](shared/schema.ts)):

| Entity | Description |
|---|---|
| **users** | Auth + KYC profile (PAN, GST, IFSC, signature, contract credits, role). |
| **deals** | Top-level engagement (`dealType`, deliverables, dates, status). |
| **contracts** | Signed agreement attached to a deal; counter-signed proof file. |
| **invoices** | Platform-fee invoices (creator pays DealInSec per contract). |
| **brand_invoices** | Client-side invoices (creator bills brand for the deal value). |
| **credit_transactions** | Ledger of credit grants, purchases, usage, referrals. |
| **payu_orders** | PayU payment intent records with hash verification. |
| **quotes** | Versioned quotation drafts per deal. |
| **referrals** | Referrer → referred user mapping with award amount. |
| **sessions** | Postgres-backed session store rows (express-session). |

---

## Getting Started

### Prerequisites
- **Node.js** 18+ (Node 20 recommended)
- **npm** 9+
- **PostgreSQL** 14+ (local) or a [Neon](https://neon.tech) free-tier connection string

### Setup

```bash
# 1. Clone
git clone https://github.com/avisekhgurung/Inflideal.git
cd Inflideal

# 2. Install dependencies
npm install

# 3. Environment variables
cp .env.example .env
# Fill in DATABASE_URL, SESSION_SECRET, IMAGEKIT_*, GOOGLE_*, STRIPE_*, PAYU_* — see Configuration below

# 4. Push schema to your database (first run)
npm run db:push

# 5. Start the dev server (hot reload, port 5000)
npm run dev
```

Open <http://localhost:5000>.

### Available scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start Express + Vite dev server with HMR |
| `npm run build` | Production build (Vite client → `dist/public`, esbuild server → `dist/index.cjs`) |
| `npm run start` | Run the production bundle (`NODE_ENV=production`) |
| `npm run check` | TypeScript type-check (`tsc --noEmit`) |
| `npm run db:push` | Sync Drizzle schema to the database (no migration files generated) |

---

## Configuration

Environment variables (`.env`):

```dotenv
# Runtime
NODE_ENV=development
PORT=5000
APP_URL=http://localhost:5000           # Set to public URL in production

# Database
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# Session
SESSION_SECRET=<long random string>

# ImageKit (file storage)
IMAGEKIT_PUBLIC_KEY=public_xxxxx
IMAGEKIT_PRIVATE_KEY=private_xxxxx
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/yourusername

# Google OAuth
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxx

# Stripe (international payments)
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# PayU (Indian payments)
PAYU_MERCHANT_KEY=xxxxx
PAYU_SALT=xxxxx
PAYU_URL=https://secure.payu.in        # Use https://test.payu.in for testing

# Pricing
CREDIT_VALUE=299                        # ₹ per contract credit
```

> **Security:** Never commit `.env`. Keep it in `.gitignore`. Rotate any secret that accidentally lands in version control or chat history.

### Required external setups

- **Google OAuth:** Add `https://<your-domain>/api/auth/google/callback` to *Authorized redirect URIs* in Google Cloud Console.
- **PayU webhook:** Configure the success/failure URLs to point at your deployed domain.
- **Stripe webhook:** Add `https://<your-domain>/api/webhooks/stripe` to your Stripe dashboard webhook endpoints.
- **ImageKit:** Create folders `dealinsec/profiles`, `dealinsec/signatures`, `dealinsec/contracts` (the upload helper will auto-create them too).

---

## Deployment

DealInSec is deployed on **Render** (Bangalore → Oregon region) with a custom domain proxied through **Cloudflare**.

### Render — Web Service settings

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm install && npm run build` |
| Start command | `npm run start` |
| HTTP Port | `8080` (Render injects `PORT`; code reads `process.env.PORT`) |
| Instance | Starter ($7/mo) — always-on, no cold starts |
| Auto-deploy | On every push to `main` |

Add the same environment variables as above to the Render dashboard (mark secrets as encrypted).

### Cloudflare DNS

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `@` (apex) | `dealinsec.onrender.com` | Proxied |
| CNAME | `www` | `dealinsec.onrender.com` | Proxied |
| TXT | `_verification` | Render-provided | DNS only |

SSL/TLS mode: **Full**.

---

## Coding Conventions

- **TypeScript strict** — no `any` without a justified comment.
- **Zod everywhere at boundaries** — `insert*Schema` derived from Drizzle tables; client forms extend these.
- **Functional React** — hooks, no class components. Co-locate page-specific subcomponents inside the page file.
- **Tailwind utility classes** — no `.css` files outside `index.css`. Use `cn()` for conditional classes.
- **Path aliases** — `@/` → `client/src/`, `@shared/` → `shared/`.
- **API contracts** — REST under `/api/*`. Response shape: JSON. Errors return `{ error: string }` with appropriate status.
- **Commit messages** — conventional-ish; lead with the area (`deals:`, `landing:`, `auth:`) and write *why*, not *what*.

---

## Roadmap

| Phase | Timeframe | Highlights |
|---|---|---|
| **Now** | 0–6 months | Scale to 5,000+ users · AI quote assistant · Native iOS/Android · UPI Autopay |
| **Next** | 6–18 months | Buyer-side B2B dashboard · Team multi-seat · GST auto-reconciliation · Invoice financing |
| **Beyond** | 18–36 months | Cross-border (SEA + GCC) · Embedded payments + escrow · Creator-business ERP · Public marketplace for deal briefs |

---

## Founders

- **Avisekh Gurung** — Engineering & Product
- **Priyat Tamang** — Operations & Growth

Built in Northeast India.

---

## License

Proprietary. © DealInSec 2026. All rights reserved.

For investor inquiries, partnership opportunities, or pilot access — visit [www.dealinsec.com](https://www.dealinsec.com).
