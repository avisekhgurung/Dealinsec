# Outreach channels: Email, WhatsApp Business, LinkedIn, X

One outreach card per lead (Lead → Overview → channel tabs). Each channel shows only the state the server checked and
only the actions that state allows. Code: `shared/channels.ts` (capabilities and limits), `server/channels/*` (service,
store, WhatsApp Cloud API client, webhook), `client/src/components/leads/channel-panel.tsx`,
`client/src/components/settings/whatsapp-card.tsx`.

| Channel | Sends from DealInSec | Delivery / read | Replies reach DealInSec | How |
|---|---|---|---|---|
| Email | Gmail, when Gmail sending is switched on (otherwise your email app) | No | Gmail reply sync, where switched on | Unchanged (`lead_messages`, `server/sales`, `server/mail`) |
| WhatsApp | Yes: the workspace's own business number, official Cloud API | Yes (webhook) | Yes (webhook) | Off until configured; opt-in required |
| LinkedIn | **No** (drafts only) | No | No: you record replies | Copy, open LinkedIn, send, "I sent it" |
| X | **No** (drafts only) | No | No: you record replies | Copy, open X, send, "I sent it" |

## Provider research (checked 18 Oct 2026)

- **LinkedIn**: "Open Permissions are the only permissions that are available to all developers without special
  approval": Sign In with LinkedIn (`profile`, `email`) and Share on LinkedIn (`w_member_social`). Sales integrations
  need the Sales Navigator Application Platform (SNAP) partner program; no open permission sends member messages,
  InMail or connection requests. Source: learn.microsoft.com/linkedin/shared/authentication/getting-access (updated
  2026-06-03). So DealInSec only drafts. Connection-note limit: 200 characters on a free account, 300 with Premium
  (LinkedIn Help, quoted by third parties; LinkedIn shows its own counter). Nothing is scraped or automated, and no
  LinkedIn password is ever asked for.
- **X**: Direct Messages are sent with `POST /2/dm_conversations/with/:participant_id/messages` using an OAuth 2.0
  (PKCE) user access token (docs.x.com). Since 6 Feb 2026 X sells pay-per-use API access to new developers; third-party
  rate cards list a DM create at about $0.015 per request (not confirmed on X's own pricing page). DealInSec has no X
  developer app or paid access, so X is drafts only. To add direct sending later: an X developer app with pay-per-use
  credits, OAuth 2.0 PKCE with `dm.write dm.read tweet.read users.read offline.access`, a per-user token sealed with
  `server/mail/token-crypto` (add "x" to `SEALED_PROVIDERS`), and the recipient must accept DMs from the sender.
- **WhatsApp**: the official WhatsApp Business Platform Cloud API (graph.facebook.com).
  - Opt-in: businesses "must clearly state that a person is opting in to receive communication from the business"
    and must have obtained it (developers.facebook.com/docs/whatsapp/overview/getting-opt-in). DealInSec requires a
    person to record, per number, how the contact agreed; a number found online is never treated as permission.
  - "Template messages are the only type of message that can be sent to WhatsApp users outside of a customer service
    window", and "Templates must have a status of APPROVED before they can be sent". DealInSec reads the approved
    templates live from the business account before drafting and again before sending, and sends free text only
    within 24 hours of the contact's last message (recorded from the webhook).
  - Pricing: Meta bills the business's own WhatsApp account per delivered template message, by category and
    country (rates change quarterly; third-party reports say service messages also became billable after a free
    allowance from 1 Oct 2026). DealInSec records each send in `provider_calls` at $0 cost to DealInSec (it isn't
    DealInSec's bill) and counts it against the plan's send allowance.
  - Webhook: `GET` answers `hub.challenge` only for our verify token; `POST` is applied only when
    `X-Hub-Signature-256` is a valid HMAC-SHA256 of the raw body with the app secret.

## Activating WhatsApp Business

1. **Meta**: a Meta Business portfolio (business verification for higher messaging limits), a Meta app of type
   Business with the WhatsApp product, a WhatsApp Business Account and a registered business phone number. A System
   User with `whatsapp_business_messaging` and `whatsapp_business_management`, and a long-lived System User token.
   Message templates created in WhatsApp Manager and approved.
2. **Webhook**: in the Meta app, set the callback URL to `https://www.dealinsec.com/api/webhooks/whatsapp`, the verify
   token to `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, and subscribe the WhatsApp Business Account to `messages`.
3. **Server environment** (Render):
   - `WHATSAPP_ENABLED=true`
   - `WHATSAPP_APP_SECRET`: the Meta app's App Secret (webhook signatures)
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: any long random string, also entered in the Meta app
   - `MAILBOX_TOKEN_KEYS` / `MAILBOX_TOKEN_KEY_CURRENT`: the existing key ring (already used for Gmail tokens)
   - optional `WHATSAPP_ALLOWED_ORG_IDS=org1,org2`: limit to pilot workspaces
   - optional `WHATSAPP_GRAPH_VERSION` (default `v23.0`)
4. **Database**: run once, deliberately (dev and production share the Neon database):
   `npx tsx --env-file=.env script/migrate-channels.ts`. Purely additive (three new tables). Until it runs, the
   WhatsApp, LinkedIn and X tabs don't appear and email outreach works exactly as before.
5. **Workspace**: an owner or admin opens Settings → Integrations → WhatsApp Business and enters the phone number ID,
   the WhatsApp Business Account ID and the access token. DealInSec checks them with WhatsApp, seals the token
   (AES-256-GCM, bound to the connection) and never shows it again. Disconnecting deletes the sealed token; revoke the
   token in Meta Business Settings too.

## Rules the code enforces

- Approval of one exact text (`body_hash`); editing sends it back to draft; a send of any other text is refused.
- One unsent message per lead and channel (database index); every status change is one guarded UPDATE.
- WhatsApp: recorded opt-in, never after an opt-out ("STOP" and similar replies opt out automatically and add the
  number to the do-not-contact list for good); free text only inside the 24-hour window; templates read live.
- A send with no answer is "uncertain" and is never retried by itself; a person marks whether it arrived.
- A reply on any channel (webhook, or recorded by the person) stops the lead's email follow-ups and moves the lead to
  "replied". Channels without reply sync say so on the card: follow-ups only stop when the reply is recorded.
- "Copy" is never a send; "I sent it" is stored as `sent_via = 'manual'` and shown as "You marked it sent".
- Allowances: AI drafts on any channel share the plan's AI-draft allowance with email; WhatsApp API sends share the
  plan's send allowance with Gmail, counted under the same per-workspace locks. Free/Pro numbers come from
  `shared/outbound-plans.ts` (env overrides `OUTBOUND_MONTHLY_DRAFTS_*`, `OUTBOUND_MONTHLY_SENDS_*`).
- Stored: message text of drafts and sent messages, WhatsApp reply text from known contacts only (messages from
  numbers the workspace never dealt with are not stored), provider ids, statuses and timestamps. Tokens never reach
  the browser or logs; the timeline records ids and channels, never text.

## Sequences

Email keeps its existing follow-up sequence (drafted for review at 3 and 5 business days, never sent unreviewed,
cancelled on a reply, opt-out, bounce or won deal). WhatsApp, LinkedIn and X have no automated steps: a follow-up on
them is a message the person writes, approves and sends. Nothing on these channels runs on a schedule.
