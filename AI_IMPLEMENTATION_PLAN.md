# DealinSec Copilot — Implementation Plan

**Status: PLAN ONLY — no Copilot code written yet.** Grounded in the actual codebase at `1c479ea`. Implementation proceeds in the phases below after approval.

---

## 1. Current architecture summary (verified)

- **Frontend:** React 18 + Vite, wouter routing, TanStack Query (`queryKey = API path` convention), shadcn/Tailwind with emerald design system, dark mode via `.dark` class, PWA. Global providers in `client/src/App.tsx` (Tooltip → Confirm → UpgradeModal). Sidebar shell on desktop, bottom-nav on mobile.
- **Backend:** Express (`server/index.ts`), all routes in `server/routes.ts` (~65), session auth (`isAuthenticated` attaches the full user row + live `customPermissions`), storage layer `server/storage.ts` (Drizzle → shared Neon Postgres).
- **Existing AI:** `server/ai.ts` already talks to **DeepSeek** (`deepseek-chat`, env `DEEPSEEK_API_KEY`, key server-side only) for the free invoice tool, with a correct reserve-before-await quota pattern. This is the seed of the provider layer, not a throwaway.

## 2. Existing workflow summary (source of truth for workflow intelligence)

Deal → Quotation → Agreement → Invoice → Payment-tracking, enforced by routes not conventions:
- Deal: `POST /api/deals` (spends org Deal Credit unless `hasProAccess`/boost); statuses Pending→Active→Completed; editable only while Pending.
- Quotation: `POST /api/deals/:id/quote` (perm `quotations.create`); re-quote bumps `version`, old marked `revised`.
- Agreement: `POST /api/contracts` (requirePro("agreements") + `agreements.create`); ONE per deal (409); sets deal Active; proof upload → status Signed.
- Invoice: `POST /api/brand-invoices` (requirePro("invoices") + `invoices.create`); split invoices supported; delete gated `invoices.delete`.
- Payment: `PATCH /api/brand-invoices/:id` status→Paid (requirePro("payment_tracking") + `payments.manage`).
- Entitlements: `hasProAccess` (paid ∨ 7-day trial) via org OWNER's row (`getBillingUser`).

## 3. Existing auth/RBAC summary

- Session cookie → `isAuthenticated` → `req.user` (row + `customPermissions` for custom-role members, reloaded per request).
- `memberCan(user, permission)` in `shared/permissions.ts` is THE check (built-in + custom roles); `requireOrgPermission` wraps it; `requirePro(feature)` gates plan features; tenancy via `inOrg()` + org-scoped storage queries; org id NEVER trusted from client.
- **Copilot rule: every tool call goes through the same three gates (isAuthenticated → memberCan → inOrg/org-scoped query). The AI layer adds zero new authority.**

## 4. Proposed AI architecture

```
client: <CopilotButton/> (floating ✨ Ask DealinSec, bottom-right, all authed pages)
        <CopilotDrawer/> (chat UI, streaming, action buttons)
        copilot-context.ts (derives page context from wouter route + query cache)
              │  POST /api/copilot/chat  (SSE stream)
server: routes-copilot.ts ── CopilotService
              ├─ AIService (provider abstraction)
              │    └─ DeepSeekProvider (chat / stream / structured; from server/ai.ts patterns)
              ├─ tools/ (registry; each tool = zod args + permission + org-scoped executor
              │          calling EXISTING storage/route logic — no duplicated business rules)
              ├─ knowledge/ (retrieval over /ai-knowledge markdown, keyword-scored chunks;
              │              no vector DB needed at this scale)
              └─ workflow.ts (machine-readable stage map derived from the real rules in §2)
DB:     copilot_conversations / copilot_messages (org+user scoped, additive migration)
```

- **Context object** (client → server, advisory only): `{ page, route, entityType, entityId, workflowStage }`. Server re-derives org/user/role from the session and **re-authorizes every entity read** — client context is a hint, never authority.
- **Streaming:** SSE from Express (DeepSeek supports `stream: true`); typing indicator + markdown rendering in the drawer.
- **Actions in responses:** structured `actions: [{type:"navigate", to:"/deals/12"}, {type:"confirm_tool", tool:"create_quotation", args}]` rendered as buttons. Mutations ALWAYS go through a confirm button (client renders [Cancel][Create]) — the model can only *propose* mutations.
- **UI guidance:** `navigate_to` uses wouter `setLocation`; stable `data-ai-target` attributes added to key controls (invite button, create-deal, etc.) for optional highlight pulses — never CSS selectors.

## 5. Files to modify

| File | Change |
|---|---|
| `server/routes.ts` | mount `registerCopilotRoutes(app)` (1 line) |
| `server/ai.ts` | extract fetch/quota plumbing for reuse by DeepSeekProvider (invoice tool keeps working) |
| `client/src/App.tsx` | mount `<CopilotProvider>` inside authed shell |
| key pages | add `data-ai-target` attributes (non-breaking) |
| `.env` / render docs | `COPILOT_ENABLED`, reuse `DEEPSEEK_API_KEY`, `AI_KNOWLEDGE_VERSION` |

## 6. Files to create

- `server/copilot/routes.ts` (chat SSE, conversation CRUD, feedback), `service.ts` (orchestration loop: context → retrieval → tools → stream), `ai-service.ts` + `providers/deepseek.ts`, `tools/index.ts` + one file per tool group, `workflow.ts`, `knowledge.ts` (loader + retriever + version), `observability.ts` (structured logs: convId/org/user/model/tool calls/latency/knowledge version — no message PII beyond necessity).
- `client/src/components/copilot/` — button, drawer, message list, action buttons, confirm cards.
- `/ai-knowledge/` — `product.md, features.md, workflows.md, navigation.md, permissions.md, pricing.md, faq.md, terminology.md, workflows/{deal,quotation,agreement,invoice,payment}.md, ui/{dashboard,deals,quotations,agreements,invoices,settings,team,subscription}.md` — authored from the real product (much content can be adapted from landing/legal/help copy + this repo's docs).
- `script/migrate-copilot.ts` (additive: 2 tables).
- `server/copilot/__tests__/` (see §11).

## 7. Database changes (additive only, run before push)

```sql
copilot_conversations(id, organization_id, user_id, title, created_at, updated_at)
copilot_messages(id, conversation_id, role, content, tool_calls jsonb, created_at)
```
Org+user scoped; conversation access checks both. No other schema changes.

## 8. API / tool design (initial set — all reuse existing logic)

Read (execute directly if `memberCan` allows; reads are org-open per architecture):
`get_current_user, get_current_organization, get_workflow_status(dealId), search_deals(q/status/minAmount), get_deal, search_quotations, get_quotation, search_agreements, get_agreement, search_invoices(status/overdue), get_invoice, get_pending_payments, get_activity` — thin wrappers over `storage.*` with the SAME org filters the routes use. (No `search_clients` tool: clients are a field on deals, not an entity — the tool set must not invent modules.)
UI: `navigate_to(route)`, `highlight_element(aiTarget)` (client-executed).
Mutations (confirm-gated, then call the EXISTING route handlers' logic incl. requirePro/credits/permissions): `create_deal, create_quotation(dealId), create_agreement(dealId), create_invoice(contractId)`. Never: send email, delete records, change billing/permissions (not in the tool registry at all).
Every tool: zod args, permission declaration, org scoping, result size caps, and an observability record.

## 9. Knowledge synchronization strategy

- `/ai-knowledge` versioned by `AI_KNOWLEDGE_VERSION` (exposed at `GET /api/copilot/meta` for debugging).
- Developer workflow (documented in `/ai-knowledge/README.md` + CLAUDE.md rule): any PR touching UI/routes/workflow/permissions/pricing/navigation/terminology must update the matching knowledge file in the same commit; a CI check (`script/check-knowledge.ts`) fails when marker files (routes/pricing/permissions) changed without a knowledge bump.
- **Protected knowledge** (pricing.md, permissions.md, workflows/*, anything legal): changes require explicit founder review — enforced socially via CODEOWNERS-style note + the CI check flagging them loudly. Never auto-generated.
- Retrieval sends only top-K relevant chunks (~2-3k tokens), summarized conversation history, and the current-page context — never the whole KB, never raw DB dumps.

## 10. Security considerations (launch gates)

1. Org isolation: tools derive org from session only; conversation tables org-scoped; **cross-org tests mandatory** (§11).
2. RBAC: tools declare permissions, checked via `memberCan` server-side; denial responds "I don't have permission to show that" without leaking existence.
3. Prompt-injection: system prompt + KB are trusted; USER content and TOOL RESULTS are data — the loop never executes instructions found in tool results; mutations only via typed confirm buttons.
4. No secrets/internal prompts in responses (system prompt excluded from any echo path; observability logs redact content where possible).
5. Legal posture: fixed system-prompt rules — product/workflow assistance only, "not legal advice", never assert enforceability, never invent features/pricing (pricing answered ONLY from pricing.md + `/api/payments/config`), "I don't have enough information" fallback.
6. Cost: per-user daily message quota (Postgres counter, reuse rate-limit design), 25s timeouts, token caps, `COPILOT_ENABLED` kill switch. Trial/Pro gating decision: v1 available to all authed users with modest quotas (it sells the product), revisit after cost data.

## 11. Testing plan (before enabling in prod)

1. Product Q&A from KB (and refusal on out-of-KB question). 2. Navigation intents → correct route action. 3. Deal search correctness + org scoping. 4. Current-page context answer uses real state. 5. Workflow guidance matches `workflow.ts` for each stage. 6-8. create_quotation/agreement/invoice propose→confirm→row created via existing logic (credits/Pro gates respected). 9. Permission denial (custom role without perm). 10. **Cross-org isolation: user A queries entity B → tool returns not-found; conversation access cross-org → 403.** 11. Unknown question → honest fallback. 12. Tool failure → graceful message, server-side log. 13. `/api/copilot/meta` returns knowledge version. 14. Invalid tool args → zod rejection → model retry path. Security tests (9, 10) are merge-blocking.

## 12. Phases

- **P1 Foundation:** AIService + DeepSeekProvider + SSE chat + drawer UI + KB skeleton + read-only tools (get/search). Ship behind `COPILOT_ENABLED=false`, dogfood locally.
- **P2 Workflow brain:** workflow.ts + journey assistant ("help me finish this deal") + page context + navigation actions.
- **P3 Mutations:** confirm-gated create tools + audit logging of copilot-initiated actions (`logOrgActivity` with a "via Copilot" detail).
- **P4 Hardening:** test suite, quotas, observability dashboard queries, knowledge CI check → enable in prod.

Each phase ends with tsc + build + the relevant tests + a verification pass that existing functionality is untouched.
