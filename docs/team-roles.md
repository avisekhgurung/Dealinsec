# Team roles and permissions

Since 13 Nov 2026 a workspace has **no built-in roles**. The Owner (code-level, holds billing) creates each role with
exactly the permissions it needs, in Settings → Team → Roles, or inline while inviting someone (the invite dialog opens
on "Create a new role" while the workspace has none).

## The permission matrix (`shared/permissions.ts`)

| Module | Permission | Lets a member… |
|---|---|---|
| Client finding | `radar.search` | run Client Radar searches, local and Social Intent scans; keep saved client profiles |
| Client finding | `leads.manage` | add and edit leads, follow-ups, the ideal-client profile, knowledge notes |
| Client finding | `outreach.send` | draft, approve and send outreach; campaigns and channels; connect a mailbox |
| Client finding | `ai.tasks` | start AI Team tasks and chats |
| Deals | `deals.create`, `deals.edit` | the Deal Suite's records |
| Quotations / Agreements / Invoices | as before | the paperwork |
| Team / Organization / Activity | as before | people, settings, the log |

Reading the finding screens (prospects, leads, outreach, coworker runs) needs **any one** finding permission
(`MODULE_READ.finding`); writing needs the module's own. The Deal Suite permissions alone no longer open Client Radar,
Leads or AI Team, and vice versa.

Where it is enforced:
- `server/routes.ts`: one guard over `/api/outbound`, `/api/social`, `/api/client-profiles`, `/api/leads`,
  `/api/ideal-client`, `/api/sales`, `/api/channels`, `/api/campaigns`, `/api/outreach`, `/api/ai-league` — reads need
  a finding permission, writes the module's own.
- `server/services/leads.ts`, the mail services, `server/ai-league/chat.ts` and every agent tool keep their own checks.
- Owners and the legacy `ADMIN` / `SALES` roles hold all four; `ACCOUNTS` holds none.

## Deploying this change

1. **Before** the first deploy of this build, run on the production database:
   `npx tsx --env-file=/etc/dealinsec/dealinsec.env script/migrate-finding-permissions.ts` (`--dry-run` first to see
   what it would do). It grants the four finding permissions to every custom role that holds `deals.create` (what used
   to gate those screens), and deletes the formerly seeded Admin / Sales / Accounts rows that nobody holds and nobody
   edited. Idempotent.
2. Deploy as usual (`bash script/deploy.sh`).

Without step 1, a member on a custom role that only has the old `deals.create` keeps the paperwork but loses Client
Radar, Leads and AI Team until the Owner edits the role.
