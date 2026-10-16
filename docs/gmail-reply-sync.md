# Gmail reply sync (Release B)

Status (16 Oct 2026): **built, tested, off by default.** Operations, settings and rollout are in
[gmail-deployment.md](gmail-deployment.md). Phases A–F below are implemented. Nothing reads a mailbox until
`GMAIL_REPLY_SYNC_ENABLED=true`, the migration has run, and a person reconnects Gmail and allows reading.

## 1. What existed before this milestone (audit, 16 Oct 2026)

| Area | What is there | Reused for reply sync |
|---|---|---|
| Gmail connection | `server/mail/connect-service.ts`: OAuth with PKCE, nonce and single-use state; tokens sealed with AES-256-GCM (`token-crypto.ts`); allowlist `GMAIL_ALLOWED_ORG_IDS` | Same flow; it now asks for one more scope when reply sync is on |
| Provider boundary | `provider.ts` (interface), `gmail-provider.ts` (no SDK), `fake-provider.ts` (tests and local runs) | Extended with read-only calls (`MailboxReader`) |
| Sending | `send-service.ts`, `send-store-pg.ts`, `mail_send_jobs`: a duplicate-send guard, leases, "uncertain" outcomes never resent. **Real Gmail sending is still off in code** (`GMAIL_SENDING_ENABLED = false`) | Threads of DealInSec sends are linked from `mail_send_jobs.provider_thread_id` |
| Outreach | `lead_messages` (draft → approved → sent), `outreach_events` (one row per message and kind; "follow_due"/"follow_done" outbox), `outreach_suppressions` (do-not-contact by address or domain) | Matching reads approved and sent outreach; Phase D writes "replied" through the same events |
| Follow-ups | A **follow-up is a task** ("Follow up with Acme" ticket, due in 4 days), not an automatic email. Nothing sends follow-up emails | Phase D closes or pauses that task when a reply arrives |
| Jobs | No queue. Two in-process `setInterval` sweeps in `server/mail/register.ts`; Render runs one instance that may sleep | Reply sync is a third sweep; its cursor lives in the database, so a sleeping instance catches up when it wakes |

Two facts shaped the design:

1. **Because real sending is off, every real outreach email today is sent by hand** from the person's own email app.
   Matching can't rely only on threads DealInSec started itself. It also recognizes the hand-sent copy in Sent mail:
   same recipient, and exactly the approved subject.
2. **A recorded decision from 14 Oct: "never send Gmail content to any AI model".** Phase E of the brief (AI reply
   classification and drafting) needs that decision revisited first; see section 8.

## 2. The Google permission

Reply sync needs **`https://www.googleapis.com/auth/gmail.readonly`**. Nothing narrower can work:

- `gmail.send` can't read anything.
- `gmail.metadata` gives headers but no message text, so a reply couldn't be shown. It is also a restricted scope, so
  it would bring the same review burden.
- `gmail.modify` and full access (`mail.google.com`) can change or delete mail. DealInSec never asks for them, and
  refuses a grant that includes them.

`gmail.readonly` is a Google **restricted** scope. What that means:

| | Testing mode (today's "dealinsec-mail" project) | Production (any Google user) |
|---|---|---|
| Who can connect | Only the listed test users (up to 100) | Anyone |
| Google review | None; people see an "unverified app" warning | Brand verification, a restricted-scope review, and a **yearly third-party security assessment** (CASA), paid by DealInSec |
| Token lifetime | Refresh tokens expire after 7 days: reconnect weekly | Normal |
| Data rules | Google's Limited Use rules apply from day one | Same, and they are audited |

**Nothing about the Google project changes automatically.** To try it in Testing mode, the founder does these steps:

1. Google Cloud Console → project **dealinsec-mail** → Google Auth Platform → **Data Access** → Add or remove scopes →
   add `.../auth/gmail.readonly` → Save. (Leave the sign-in project alone.)
2. Render: set `GMAIL_REPLY_SYNC_ENABLED=true`. It works only for organizations in `GMAIL_ALLOWED_ORG_IDS`.
3. Run the migration (section 6).
4. In DealInSec Settings → Gmail, choose **Allow** (or Reconnect), and on Google's screen keep "Read your email" ticked.

To leave Testing mode, publish the app and submit it for verification, then complete the security assessment.
Expect weeks, not days. Until then, keep the allowlist to the founder's own test accounts.

## 3. How a sync pass works

`server/mail/sync-service.ts`. The sweep runs every minute and does a few due mailboxes per tick. Each mailbox
is checked about every 3 minutes, or right away with "Check now" in Settings.

1. **Lease.** One pass per mailbox at a time, across processes (`mail_sync_state.lease_owner`, with expiry). Every
   cursor write is fenced by the lease owner.
2. **Access.** It refreshes the access token. If Google has revoked the grant, the mailbox is marked "reconnect
   needed" and its token deleted. If there is no read scope, the state becomes `needs_scope` and nothing is read.
3. **Threads DealInSec sent** are linked from `mail_send_jobs`.
4. **First pass.** It reads the linked threads, then searches the mailbox only for the addresses this person's
   outreach went to in the last 60 days. Results are decided oldest first. The cursor then starts at the mailbox's
   history id, which was read before the scan, so nothing that arrives during it is missed.
5. **Later passes.** It reads Gmail's change history (`history.list`, messages added) after the cursor. The cursor
   moves only past change records whose messages have all been decided.
6. **Each new message.** Drafts, spam, trash and chats are skipped without a read. Everything else gets a
   **metadata** read: the matching headers only, never the body. If it belongs to a conversation, the body is read
   and stored; if not, nothing is stored. Unrelated mail is never stored and its body is never fetched.
7. **Bounded work.** A pass makes at most 150 message reads (300 on the first pass) and 10 history pages. Anything
   left over runs in the next pass, which is due immediately.

| Failure | What happens |
|---|---|
| Gmail asks us to slow down; outage; timeout | The cursor is kept. Retry with exponential backoff (2 min, doubling, ±20% jitter, capped at 1 hour), or Gmail's `Retry-After` if longer |
| History too old (Gmail answers 404) | The cursor is reset and a first pass runs again. Messages already stored are skipped as known, so nothing is duplicated |
| Grant revoked | The mailbox needs reconnecting; sync stops until it is reconnected |
| Read permission missing | State `needs_permission` in Settings; sync wakes when the mailbox is reconnected |
| Crash mid-pass | The lease expires after 2 minutes; the next pass resumes from the last checkpoint |

Push notifications (Gmail `watch` through Cloud Pub/Sub) are **not** used. Polling every few minutes is the reliable
baseline the brief asks for. Push would need a Pub/Sub topic, a public webhook, renewal every 7 days and still a
reconciliation pass, which is more infrastructure than this volume needs. It can be added later as a "sync now"
trigger.

## 4. Which conversation a message belongs to

`server/mail/reply-match.ts` (pure, fully tested). Strongest signal first:

| Match | Rule | Result |
|---|---|---|
| `thread` | The Gmail thread is linked to an outreach message | Linked |
| `reference` | Its `In-Reply-To` / `References` name a Message-ID we know (one DealInSec sent, or one synced into a linked thread). Covers replies with a changed subject, which Gmail puts in a new thread | Linked; its thread is adopted |
| `adopted` | An outgoing copy in the person's Sent mail, to the outreach address, with exactly the approved subject (prefixes and case ignored) | Thread adopted; the copy's body is not kept |
| `address` | Only the sender's address matches someone this organization's outreach went to | **Kept for review, not linked**; visible only to the mailbox owner |

More rules:

- **A display name never matches anything.** Addresses come from the `<address>` part of a header.
- In a linked thread, a message **from another address** (a colleague, a forward) is linked but flagged `other_sender`
  for review. Bounces (mailer-daemon, delivery reports) and auto-replies (`Auto-Submitted`, `Precedence`, "Out of
  office" subjects) are kept with their own kind, so they will never count as a human reply.
- When a thread becomes linked later, its earlier review-only messages join the conversation, and other senders stay
  flagged.
- **Idempotent.** `mail_messages` is unique on (mailbox, Gmail message id). A message seen twice (duplicate history,
  a reset cursor, two processes) is stored once, and a thread is linked once (first link wins).
- **Isolated.** Every lookup is scoped by organization *and* mailbox. Another organization writing to the same address
  never links to yours.

## 5. What is stored, for how long, and who sees it

Three tables (`server/mail/mail-sync-schema.ts`, `script/migrate-mail-sync.ts`):

- `mail_sync_state`: cursor, lease, retry state.
- `mail_threads`: Gmail thread → outreach message.
- `mail_messages`, per message: sender address and display name, recipient addresses, subject (300 characters), the
  body **as plain text with quoted history removed** (20,000 characters), Message-ID and In-Reply-To, time, and match
  and review fields.

Never stored: HTML, attachments, raw MIME, labels, CC/BCC lists, tokens, or anything from unrelated mail. HTML is
reduced to text on arrival and never rendered.

- **Disconnecting deletes every synced message, thread and cursor of that mailbox** (the decision recorded when Gmail
  was connected). A sweep deletes anything a failed disconnect left behind.
- **Visibility** (the 14 Oct decision): conversations are visible to organization members who can open the lead.
  Review-only messages are visible only to the mailbox owner. The APIs that show them arrive with Phase C.
- **Logs** carry ids, counts and codes only, never an address, subject, body or token. Tests check this.
- **Retention:** synced text is deleted after `MAIL_SYNC_RETENTION_DAYS` (365 by default; the sender, time and match
  stay). This default is a decision for the founder to confirm.

## 6. Turning it on (local, then production)

Local, against a throwaway database (never the shared Neon one):

```
DATABASE_URL=postgresql://postgres@127.0.0.1:55470/mailtest npx tsx script/migrate-mail-sync.ts --check
DATABASE_URL=postgresql://postgres@127.0.0.1:55470/mailtest npx tsx script/migrate-mail-sync.ts
MAILBOX_PG_TEST_URL=postgresql://postgres@127.0.0.1:55470/mailtest npx vitest run server/mail
```

Production, deliberately, after the code is deployed:

1. `npx tsx --env-file=.env script/migrate-mail-sync.ts --check`, then without `--check`. It is additive: three new
   tables, nothing existing touched. Deploying the code before the migration is safe: sync stays off, and connecting
   and sending are unaffected.
2. Add the scope in Google Cloud (section 2), then set `GMAIL_REPLY_SYNC_ENABLED=true` on Render.
3. Reconnect Gmail in Settings and allow reading. "Check now" runs a pass; the card shows when it last checked.

Rollback: set `GMAIL_REPLY_SYNC_ENABLED=false` (sync stops; new connections stop asking to read). Data can then be
deleted with `DROP TABLE mail_messages, mail_threads, mail_sync_state`. These are copies; the mailbox is untouched.

## 7. What a reply changes, the inbox, follow-ups and deals (Phases C–F, built)

- **Labels (`reply-rules.ts`), fixed rules only:**
  - Bounce, opt-out (wins over everything), out of office, then a single clear intent: interested, wants more
    information, or not interested.
  - Anything mixed or unclear is "needs review".
  - Stored with the rules' version. A person can correct a label, and the correction is applied again.
- **Applying (`reply-apply.ts`)** runs once per message, from the `applied_at` outbox, in one transaction (lock order:
  mail message, outreach messages, lead, address keys):
  - **A reply:** "replied" is recorded on the outreach, the lead moves to Replied, follow-ups and their drafts and
    task are cancelled, and the conversation status is set.
  - **An opt-out:** the address goes on the do-not-contact list, the lead is marked do-not-contact, unsent messages to
    that address are cancelled from every lead, and follow-ups are cancelled.
  - **A bounce:** the outreach address goes on the list, and follow-ups are cancelled.
  - **Out of office:** nothing changes.
  - **Awaiting review:** follow-ups are *held*. Confirming applies the reply; dismissing releases them. An opt-out
    from the address we wrote to is applied even before review.
  - Timeline entries carry ids only. The activity log gets "Acme replied to your outreach", with no message content.
- **Follow-ups (`outreach_followups`, `sales/followups.ts`):**
  - Scheduled in the same transaction that records a send (3 business days, then 5; at most two).
  - When one falls due, it becomes a **draft** for review: a template filled from the lead, with no model call. It is
    never sent automatically.
  - It is rechecked before drafting (no reply, not do-not-contact, not suppressed, lead still being contacted), and
    rechecked again when its send is reserved (`followup_stopped`).
  - A follow-up sent through Gmail goes into the outreach's thread (`In-Reply-To`, `References`, `threadId`).
- **Inbox** (AI Outbound → Inbox, `inbox.ts`):
  - Conversations with filters and counts: all, awaiting reply, replied, interested, needs review, follow-up due.
  - Search by company, subject or address. Pages of 30.
  - Each conversation shows its messages in order, its label (marked as rules, not AI), its follow-ups, and the next
    step: open the lead or deal, Reply in Gmail (the mailbox owner only), **Review and create deal**.
  - **Review and create deal** opens the existing deal form on the lead for confirmation. Lead conversion is atomic,
    so there are no duplicates.
  - Review queue: "might be for your leads", visible to the mailbox owner only.

## 8. AI and Gmail content

The founder kept the 14 Oct rule (16 Oct): **Gmail content never reaches an AI model.**
- No model call in sync, labelling, applying, the inbox or follow-up drafting (`reply-workflow.pg.test.ts` fails if
  one happens).
- No AI module imported by the Gmail code, and no AI code reading synced mail (`no-ai.test.ts`).
- The AI agent can see that a lead was replied to (its stage, and timeline ids), never what the reply said.
