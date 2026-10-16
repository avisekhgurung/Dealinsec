/**
 * The reply-sync tables (Gmail Release B, docs/gmail-reply-sync.md), migrated by script/migrate-mail-sync.ts with the
 * same refuse-on-conflict machinery as the mailbox tables (mailbox-schema.ts). Kept as a separate set with its own
 * presence check, so deploying this code before the migration runs leaves sending and connecting untouched: only
 * reply sync stays off.
 *
 *   mail_sync_state  one row per connected mailbox: the Gmail history cursor, the lease, retry state and health
 *   mail_threads     a Gmail thread tied to one outreach message (sent from DealInSec, adopted, or found by reference)
 *   mail_messages    the synced messages of those conversations: the minimum to show and act on them
 *
 * Nothing here holds a token, a raw message or HTML. Bodies are plain text, quoted history removed, capped at 20,000
 * characters (mail-parse.ts). Disconnecting a mailbox deletes its rows in all three tables.
 */
import { mailboxSchemaPresent, runMailboxMigration, type Exec, type MailboxMigrationResult, type TableSpec } from "./mailbox-schema";

export const SYNC_STATES = ["ok", "retrying", "needs_reconnect", "needs_scope"] as const;
export const THREAD_SOURCES = ["send", "adopted", "reference"] as const;
export const MESSAGE_KINDS = ["reply", "auto_reply", "bounce", "own_reply", "outreach_copy"] as const;
export const MATCH_KINDS = ["thread", "reference", "adopted", "address"] as const;
export const REVIEW_STATES = ["none", "pending", "confirmed", "dismissed"] as const;
const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

export const MAIL_SYNC_TABLES: TableSpec[] = [
  {
    name: "mail_sync_state",
    columns: [
      ["id", "serial PRIMARY KEY"],
      ["organization_id", "varchar NOT NULL"],
      ["connection_id", "integer NOT NULL"], // mailbox_connections.id
      ["history_id", "varchar(24)"], // Gmail's history id to resume after; null until the first full pass
      ["bootstrapped_at", "timestamp"],
      ["state", "varchar(16) NOT NULL"],
      ["lease_owner", "varchar(40)"], // one pass at a time per mailbox, across processes
      ["lease_until", "timestamp"],
      ["next_run_at", "timestamp NOT NULL"],
      ["last_run_at", "timestamp"],
      ["last_success_at", "timestamp"],
      ["failures", "integer NOT NULL DEFAULT 0"], // consecutive; drives the backoff
      ["last_error_code", "varchar(40)"],
      ["last_error_at", "timestamp"],
      ["created_at", "timestamp NOT NULL"],
      ["updated_at", "timestamp NOT NULL"],
    ],
    checks: [
      ["mail_sync_state_state_ck", `state IN (${list(SYNC_STATES)})`],
      ["mail_sync_state_failures_ck", `failures >= 0`],
      ["mail_sync_state_lease_ck", `(lease_owner IS NULL) = (lease_until IS NULL)`],
    ],
    indexes: [
      { name: "mail_sync_state_connection_uq", unique: true, columns: ["connection_id"] },
      { name: "mail_sync_state_due_idx", columns: ["next_run_at"] },
    ],
  },
  {
    name: "mail_threads",
    columns: [
      ["id", "serial PRIMARY KEY"],
      ["organization_id", "varchar NOT NULL"],
      ["connection_id", "integer NOT NULL"],
      ["provider_thread_id", "varchar(200) NOT NULL"],
      ["lead_id", "integer NOT NULL"],
      ["lead_message_id", "integer NOT NULL"], // the outreach message (lead_messages.id) this conversation started from
      ["source", "varchar(12) NOT NULL"],
      ["last_message_at", "timestamp"],
      ["last_inbound_at", "timestamp"],
      ["created_at", "timestamp NOT NULL"],
      ["updated_at", "timestamp NOT NULL"],
    ],
    checks: [["mail_threads_source_ck", `source IN (${list(THREAD_SOURCES)})`]],
    indexes: [
      { name: "mail_threads_connection_thread_uq", unique: true, columns: ["connection_id", "provider_thread_id"] },
      { name: "mail_threads_lead_idx", columns: ["organization_id", "lead_id"] },
      { name: "mail_threads_message_idx", columns: ["organization_id", "lead_message_id"] },
    ],
  },
  {
    name: "mail_messages",
    columns: [
      ["id", "serial PRIMARY KEY"],
      ["organization_id", "varchar NOT NULL"],
      ["connection_id", "integer NOT NULL"],
      ["provider_message_id", "varchar(200) NOT NULL"],
      ["provider_thread_id", "varchar(200) NOT NULL"],
      ["thread_id", "integer"], // mail_threads.id; null for an address-only match awaiting review
      ["lead_id", "integer NOT NULL"], // for an address-only match: the suggestion, shown only to the mailbox owner
      ["lead_message_id", "integer NOT NULL"],
      ["direction", "varchar(3) NOT NULL"],
      ["kind", "varchar(16) NOT NULL"],
      ["match_kind", "varchar(12) NOT NULL"],
      ["review_reason", "varchar(16)"], // address_only | other_sender
      ["review_state", "varchar(12) NOT NULL"],
      ["from_address", "varchar(254)"],
      ["from_name", "varchar(120)"], // shown only, never matched on
      ["to_addresses", "jsonb NOT NULL DEFAULT '[]'::jsonb"],
      ["subject", "varchar(300) NOT NULL DEFAULT ''"],
      ["body_text", "text"], // plain text, quoted history removed; null when not kept (an outgoing copy of approved text)
      ["body_trimmed", "boolean NOT NULL DEFAULT false"],
      ["rfc_message_id", "varchar(255)"],
      ["in_reply_to", "varchar(255)"],
      ["sent_at", "timestamp NOT NULL"],
      ["applied_at", "timestamp"], // when its effect on the outreach (replied, follow-up paused) was applied: the outbox
      ["created_at", "timestamp NOT NULL"],
    ],
    checks: [
      ["mail_messages_direction_ck", `direction IN ('in', 'out')`],
      ["mail_messages_kind_ck", `kind IN (${list(MESSAGE_KINDS)})`],
      ["mail_messages_match_ck", `match_kind IN (${list(MATCH_KINDS)})`],
      ["mail_messages_review_ck", `review_state IN (${list(REVIEW_STATES)}) AND (review_reason IS NULL OR review_reason IN ('address_only', 'other_sender'))`],
      // Only a linked message has a thread; an address-only match is linked once a person confirms it.
      ["mail_messages_thread_ck", `thread_id IS NOT NULL OR (match_kind = 'address' AND review_state <> 'confirmed')`],
    ],
    indexes: [
      // The idempotency key: a message is stored once per mailbox, however often it is seen.
      { name: "mail_messages_provider_uq", unique: true, columns: ["connection_id", "provider_message_id"] },
      { name: "mail_messages_lead_idx", columns: ["organization_id", "lead_id", "sent_at"] },
      { name: "mail_messages_thread_idx", columns: ["thread_id", "sent_at"] },
      { name: "mail_messages_rfc_idx", columns: ["connection_id", "rfc_message_id"], where: "rfc_message_id IS NOT NULL" },
      { name: "mail_messages_review_idx", columns: ["organization_id", "connection_id"], where: "review_state = 'pending'" },
      { name: "mail_messages_unapplied_idx", columns: ["organization_id", "created_at"], where: "applied_at IS NULL AND direction = 'in'" },
    ],
  },
];

export const MAIL_SYNC_TABLE_NAMES = MAIL_SYNC_TABLES.map((t) => t.name);

export function runMailSyncMigration(exec: Exec, opts: { dryRun?: boolean } = {}): Promise<MailboxMigrationResult> {
  return runMailboxMigration(exec, { ...opts, tables: MAIL_SYNC_TABLES });
}

export function mailSyncSchemaPresent(exec: Exec) {
  return mailboxSchemaPresent(exec, MAIL_SYNC_TABLES);
}
