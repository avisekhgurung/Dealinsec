# Gmail integration: deployment and operations

How to switch on, test, roll back and operate the Gmail integration: connecting, sending approved email, reply sync,
the inbox, and follow-ups. Design detail: [gmail-reply-sync.md](gmail-reply-sync.md).

**Status (16 Oct 2026):**
- Code complete and tested locally. Everything is off unless switched on.
- Google has **not** verified the app. The "dealinsec-mail" project is in Testing mode, so only its listed test users
  can connect.

## 1. Settings (Render environment)

| Variable | Default | What it does |
|---|---|---|
| `GMAIL_INTEGRATION_ENABLED` | off | `true` lets people connect Gmail. Nothing else works without it. |
| `GMAIL_ALLOWED_ORG_IDS` | every organization | A comma-separated list of organization ids. Only these see or use Gmail. Keep it set while Google verification is pending. |
| `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET` | none | The OAuth client from the "dealinsec-mail" Google project. |
| `GMAIL_OAUTH_REDIRECT_URI` | none | Exactly `https://www.dealinsec.com/api/integrations/gmail/callback`. |
| `MAILBOX_TOKEN_KEYS`, `MAILBOX_TOKEN_KEY_CURRENT` | none | The key ring that encrypts refresh tokens (`1:<base64 32 bytes>`). Never change a key that has been used; add a new version instead. |
| `GMAIL_SENDING_ENABLED` | **off** | `true` lets approved messages be sent through Gmail. Off means people send by hand from their email app and mark the message as sent. |
| `MAIL_SEND_DAILY_CAP` | 50 | Sends per mailbox per rolling 24 hours (1–2000). An invalid value means nothing can be sent. |
| `GMAIL_REPLY_SYNC_ENABLED` | **off** | `true` asks for read access when connecting and syncs replies. It also needs the migration (section 3). |
| `MAIL_SYNC_RETENTION_DAYS` | 365 | Synced message text is deleted after this many days (30–3650), or `off` to keep it until disconnect. |
| `OUTREACH_FOLLOWUP_BUSINESS_DAYS` | `3,5` | The follow-up sequence: first follow-up 3 business days after the outreach, second 5 after that. The number of values is the maximum number of follow-ups (up to 5). `off` turns follow-ups off. |
| `MAIL_PROVIDER` | `gmail` | `fake` is for local runs only and is refused in production. |

- **What the server reports at start-up.** It logs one `gmail_config` line: integration on or off and why, provider,
  whether sending is possible, whether reply sync is on, and any malformed setting by name. Values and secrets are
  never logged.
- **Malformed settings.**
  - A wrong `GMAIL_*` value turns the integration off ("misconfigured"). It never falls back to the fake provider.
  - A wrong follow-up or retention value uses the default, and the start-up line says so.

## 2. Google Cloud (project "dealinsec-mail", not the sign-in project)

1. **APIs & Services → Library:** the Gmail API is enabled.
2. **Google Auth Platform → Data Access:** these scopes, and only these:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/gmail.send`
   - `.../auth/gmail.readonly`, only if reply sync will be used. It is a restricted scope.

   Never add `gmail.modify`, `gmail.metadata` or `https://mail.google.com/`. DealInSec refuses a connection that
   grants any of them.
3. **Clients:** the web client has the redirect URI above. For local work, also add
   `http://localhost:<port>/api/integrations/gmail/callback`.
4. **Audience:** Testing mode, with the test users listed (up to 100). In Testing mode:
   - people see an "unverified app" screen;
   - refresh tokens expire after 7 days, so people reconnect weekly.

**Verification, before anyone outside the test-user list can connect:**
- Publish the app and submit it for verification: the branding, the privacy policy URL (`/privacy`, which now has a
  "Connected Gmail" section with the Limited Use statement) and a demo video.
- `gmail.send` is a *sensitive* scope and needs Google's review.
- `gmail.readonly` is a *restricted* scope and additionally needs a third-party security assessment (CASA), paid by
  DealInSec and renewed every year.

Expect weeks. None of this has been done yet.

## 3. Database migrations (shared Neon database: run deliberately)

Two migrations, both additive and safe to re-run. Each refuses, changing nothing, if something in the database
conflicts.

```
npx tsx --env-file=.env script/migrate-mailbox.ts --check      # already applied on 14 Oct
npx tsx --env-file=.env script/migrate-mail-sync.ts --check
npx tsx --env-file=.env script/migrate-mail-sync.ts
```

- **First run, 16 Oct:** `migrate-mail-sync` created `mail_sync_state`, `mail_threads` and `mail_messages`.
- **Re-run it for this update.** It creates `outreach_followups` and adds the new columns:
  - `mail_threads.status` and `status_at`;
  - `mail_messages.classification`, `classified_by`, `classifier_version` and `body_removed_at`.

  It also adds two checks and their indexes. It prints exactly what it added.
- **Order is safe either way.** If the code is deployed before the migration:
  - the inbox answers "not set up";
  - reply sync stays off;
  - follow-ups fall back to the old single reminder task.

  Nothing breaks. Running the migration first is still cleaner.
- **Rollback** (synced copies only; the mailbox itself is untouched):
  `DROP TABLE outreach_followups, mail_messages, mail_threads, mail_sync_state;`

## 4. Safe deployment order

1. Run `migrate-mail-sync.ts --check`, then run it for real.
2. Deploy the code; Render deploys `main`. Confirm the new bundle is live and read the `gmail_config` line in the logs.
3. Reply sync: in Google, add the `gmail.readonly` scope (section 2); on Render, set `GMAIL_REPLY_SYNC_ENABLED=true`.
   Then reconnect Gmail in Settings, choose **Allow**, and keep "View your email messages and settings" ticked.
4. Check: Settings → Gmail shows "Replies to your outreach are synced every few minutes" and a last-check time.
   AI Outbound → **Inbox** shows conversations.
5. Real sending, last and only when decided. See section 7 for what must be settled first. Then:
   1. Set `GMAIL_SENDING_ENABLED=true`.
   2. Send one approved message to an address you own (the canary).
   3. Confirm it arrived with the right subject, sender and thread.

## 5. Testing with a dedicated Gmail account

Use a Gmail account that holds nothing private, such as avisekhgurung099@gmail.com, listed as a test user, plus a
second address you own as the "prospect".

1. Create a lead with the second address. Draft and approve the outreach.
2. Send it:
   - with `GMAIL_SENDING_ENABLED` off, from Gmail by hand, with exactly the approved subject, then **Mark sent**;
   - with it on, with **Send from my Gmail**.
3. Reply from the second address. In Settings or the Inbox, click **Check now**. The conversation appears, labelled
   by the rules, and its follow-up shows as "Stopped (they replied)".
4. Reply "unsubscribe" from the second address and check now. The address is on the do-not-contact list, and the
   lead is marked do-not-contact.
5. Write from the second address with a new subject outside the thread. It waits in "might be for your leads",
   visible only to you. Confirm it, or dismiss it.
6. Follow-ups: with a test value such as `OUTREACH_FOLLOWUP_BUSINESS_DAYS=1,1`, a draft appears in **Outreach** one
   business day after sending, if nobody replied.

## 6. Turning things off, and what happens to data

| To stop | Do | Effect |
|---|---|---|
| Real sending | `GMAIL_SENDING_ENABLED=false` | **Send from my Gmail** refuses ("not switched on"). Sending by hand still works. Uncertain sends stay for a person to settle. |
| Reply sync | `GMAIL_REPLY_SYNC_ENABLED=false` | No mailbox is read. The inbox keeps what was synced. New connections stop asking for read access. |
| All of Gmail | `GMAIL_INTEGRATION_ENABLED=false` | Nobody can connect. Existing connections stay visible so people can disconnect. Disconnecting still revokes and deletes. |
| Follow-ups | `OUTREACH_FOLLOWUP_BUSINESS_DAYS=off` | No new steps are scheduled. Existing drafts stay drafts. |
| One person's mailbox | They click **Disconnect** (or an admin removes the member) | Google access is revoked, the refresh token is deleted, and every synced message, thread and sync cursor for that mailbox is deleted. If that deletion fails, a sweep every 2 minutes deletes what is left. An audit row (which account, when) stays. |
| Old message text | `MAIL_SYNC_RETENTION_DAYS` | The text is removed after the period; the sender, time and match stay, so the conversation still reads. |

If someone removes DealInSec in their Google account, the next sync or send gets "invalid grant". The token is
deleted and Settings asks them to reconnect.

## 7. Known limitations and decisions still open

- **Google verification**, section 2. Until it's done, only test users can connect, and they reconnect every 7 days.
- **Real sending is off.** Before turning it on for cold outreach, decide what each email says about opting out and
  who is sending. US commercial email rules (CAN-SPAM) expect a working opt-out and a physical postal address. That is
  a legal decision for the founder. The follow-up drafts include "just reply and I won't follow up again", and opt-out
  replies are honoured automatically, but no footer is added.
- **Business days are Monday to Friday in UTC**, without public holidays.
- **No push notifications.** Sync checks each mailbox every ~3 minutes while the server is awake. A sleeping Render
  instance catches up from its saved cursor when it wakes.
- **One connected mailbox per person** (and per Google account). Several mailboxes per person are not supported.
- **Answering replies happens in Gmail** ("Reply in Gmail" in the conversation). DealInSec doesn't compose replies.
  Follow-ups are its only outgoing messages besides the outreach.
- **AI:** no Gmail content is ever sent to an AI model (founder's rule). Reply labels come from fixed rules and are
  shown as such. Follow-up drafts are a template filled from the lead's own details.
