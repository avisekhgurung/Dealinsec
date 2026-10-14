/**
 * Connecting a Gmail mailbox: the words both sides use. The callback sends the browser back to Settings with one
 * of these fixed outcome codes; the page shows the matching sentence and never renders text from the URL.
 */

export const CONNECT_OUTCOMES = {
  connected: "Gmail connected. Sending from it arrives in a later update; nothing is sent automatically.",
  reconnected: "Gmail reconnected.",
  denied: "You cancelled on the Google screen, so nothing was connected.",
  expired: "That connection attempt took too long. Start again.",
  invalid_request: "That connection link isn't valid any more. Start again from Settings.",
  not_allowed: "Your role doesn't allow connecting a mailbox. Ask your organization owner.",
  missing_send_scope: "Google didn't grant permission to send email. Connect again and keep \"Send email on your behalf\" ticked.",
  unexpected_scope: "Google granted more access than DealInSec asks for, so nothing was connected. Remove DealInSec in your Google account and connect again.",
  unverified_email: "That Google account's email address isn't verified, so it can't be connected.",
  identity_invalid: "Google's answer couldn't be verified, so nothing was connected. Try again.",
  identity_mismatch: "Your mailbox is connected to a different Google account. Disconnect it first to switch accounts.",
  account_in_use: "That Google account is already connected in DealInSec. Disconnect it there first.",
  unavailable: "Connecting Gmail isn't available right now.",
  failed: "Google didn't complete the connection. Try again in a moment.",
} as const;
export type ConnectOutcome = keyof typeof CONNECT_OUTCOMES;
export const isConnectOutcome = (v: unknown): v is ConnectOutcome => typeof v === "string" && Object.prototype.hasOwnProperty.call(CONNECT_OUTCOMES, v);

/** Why a connected mailbox needs reconnecting. */
export const CONNECTION_PROBLEMS = {
  revoked: "Google no longer accepts this connection (access was removed or expired). Reconnect to keep using it.",
  missing_send_scope: "This connection can't send email. Reconnect and keep \"Send email on your behalf\" ticked.",
  token_unreadable: "DealInSec can no longer read the stored access for this mailbox. Reconnect it.",
  reconnect_required: "This mailbox needs to be reconnected.",
} as const;
export type ConnectionProblem = keyof typeof CONNECTION_PROBLEMS;
export const problemMessage = (code: string | null | undefined) =>
  code ? (CONNECTION_PROBLEMS as Record<string, string>)[code] ?? CONNECTION_PROBLEMS.reconnect_required : null;

/** Shown before connecting, and on the card: what connecting does and who can see what. */
export const CONNECT_DISCLOSURE = [
  "DealInSec asks Google only to see your email address and to send email as you. It can't read, change or delete anything in your mailbox.",
  "Only you can send from your mailbox; owners and admins can't send as you. Every message still needs your approval first.",
  "When reply syncing arrives, conversations with your leads will be visible to members of your organization who can open those leads.",
  "Disconnecting removes DealInSec's access at Google and deletes the stored credentials. A minimal record (which account, when) is kept for your organization's audit history.",
];

export interface GmailConnectionView {
  status: "active" | "needs_reconnect";
  accountEmail: string;
  capabilities: { identify: boolean; send: boolean };
  connectedAt: string;
  problem: { code: string; message: string; at: string | null } | null;
}
export interface GmailStatusView {
  available: boolean; // connecting is possible on this server
  sendingEnabled: boolean; // this build may send from a connected mailbox (never through the real Gmail adapter yet; the local fake only)
  canConnect: boolean; // this person's role allows it
  connection: GmailConnectionView | null;
}
export type VerifyResult = "ok" | "not_connected" | "needs_reconnect" | "temporarily_unavailable";

/* ── sending an approved message from the connected mailbox ─────────────────────────── */

export type SendStatus = "sending" | "sent" | "uncertain" | "failed" | "blocked";
/** What happened to a send, in the person's words. Keyed by the job's error code (or its status when there is none). */
export const SEND_MESSAGES: Record<string, string> = {
  sending: "Sending from your Gmail…",
  sent: "Sent from your Gmail.",
  uncertain: "Gmail didn't confirm whether this went out. Check your Gmail Sent folder, then tell DealInSec what you found.",
  provider_timeout: "Gmail didn't answer in time, so DealInSec can't tell whether it went out. Check your Gmail Sent folder, then tell DealInSec what you found.",
  provider_uncertain: "Gmail's answer was unclear, so DealInSec can't tell whether it went out. Check your Gmail Sent folder, then tell DealInSec what you found.",
  lease_expired: "The send was interrupted, so DealInSec can't tell whether it went out. Check your Gmail Sent folder, then tell DealInSec what you found.",
  unrecorded: "Gmail accepted the message, but DealInSec couldn't record it yet. It will not be sent again. Check your Gmail Sent folder to confirm.",
  rejected: "Gmail refused this message, so nothing was sent. You can try again or send it from your email app.",
  rate_limited: "Gmail asked DealInSec to slow down, so nothing was sent. Try again in a few minutes.",
  mailbox_reconnect: "Your Gmail connection needs reconnecting (Settings), so nothing was sent.",
  missing_send_scope: "Your Gmail connection can't send email. Reconnect it in Settings and keep \"Send email on your behalf\" ticked. Nothing was sent.",
  resolved_not_sent: "You confirmed this didn't go out. It's approved again: send it when you're ready.",
  failed: "Nothing was sent. You can try again.",
  blocked: "Nothing was sent. Reconnect your Gmail in Settings, then try again.",
};
export const sendMessage = (status: SendStatus, code: string | null | undefined) => (code && SEND_MESSAGES[code]) || SEND_MESSAGES[status] || SEND_MESSAGES.failed;

export interface SendView {
  messageId: number;
  status: SendStatus;
  code: string | null;
  message: string;
  attempts: number;
  sentAt: string | null;
  resolvedAt: string | null;
  /** Only the person whose mailbox it was (or an admin, once that person has left) may settle an uncertain send. */
  canResolve: boolean;
  /** Certainly not sent: a deliberate retry is safe. */
  canRetry: boolean;
}
export type SendOutcome = "sent" | "uncertain" | "failed" | "already_sent";
export const RESOLVE_DECISIONS = ["sent", "not_sent"] as const;
export type ResolveDecision = (typeof RESOLVE_DECISIONS)[number];
