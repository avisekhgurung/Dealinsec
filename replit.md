# InfluDeal - Influencer Deal, Contract & Billing Platform

## Overview

InfluDeal is a mobile-first SaaS web application designed for influencers to professionally manage brand deals, contracts, and billing. The platform enables influencers to track deals with brands, sign exclusive contracts, generate invoices, and handle payments. The monetization model is per-contract based rather than subscription-based.

Primary users are influencers who manage their brand partnerships through this platform. The UI is designed to feel like a native mobile app with bottom navigation, card-based layouts, and touch-friendly interactions.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Routing**: Wouter (lightweight client-side routing)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with mobile-first approach
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Design System**: Material Design principles adapted for mobile SaaS, with card-based hierarchy and 44px minimum tap targets

### Backend Architecture
- **Runtime**: Node.js with Express
- **API Pattern**: RESTful API endpoints under `/api/*`
- **File Uploads**: Multer for handling PDF and image uploads (stored locally in `/uploads`)
- **Build System**: Vite for frontend, esbuild for server bundling

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts` contains all data models using Zod for validation
- **Core Entities**: Deals, Contracts, Invoices with defined status workflows

### Authentication
- **Current Implementation**: Mock authentication with localStorage persistence
- **Auth Context**: React context provider managing login state
- **Protected Routes**: Route guard pattern redirecting unauthenticated users to login

### Key Data Models
- **Deals**: Brand partnerships with deliverables (platform, content type, quantity, frequency)
- **Contracts**: Signed agreements linked to deals with proof file uploads
- **Invoices**: Billing documents with platform fee calculations and payment status

### Project Structure
```
client/src/          # React frontend
  components/        # Reusable UI components
  pages/            # Route-level page components
  lib/              # Utilities, auth context, query client
server/             # Express backend
  routes.ts         # API endpoint definitions
  storage.ts        # Data access layer
shared/             # Shared types and schemas
  schema.ts         # Zod schemas for all entities
```

## External Dependencies

### Database
- **PostgreSQL**: Primary database (configured via `DATABASE_URL` environment variable)
- **Drizzle ORM**: Type-safe database queries and migrations
- **drizzle-kit**: Database migration tooling (`npm run db:push`)

### UI Framework
- **Radix UI**: Accessible component primitives (dialogs, dropdowns, forms)
- **shadcn/ui**: Pre-built component library with Tailwind styling
- **Lucide React**: Icon library
- **react-icons**: Additional platform icons (Instagram, YouTube, Twitter)

### Form Handling
- **react-hook-form**: Form state management
- **@hookform/resolvers**: Zod schema integration for validation
- **Zod**: Runtime type validation shared between client and server

### File Storage
- **Multer**: Multipart form handling for file uploads
- **Local filesystem**: Uploaded files stored in `/uploads` directory

### Development Tools
- **Vite**: Frontend dev server with HMR
- **tsx**: TypeScript execution for server
- **Replit plugins**: Error overlay, cartographer, dev banner for Replit environment