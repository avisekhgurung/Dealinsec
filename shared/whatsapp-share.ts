/**
 * "Share on WhatsApp": a prefilled message the person reviews, edits and sends themselves from WhatsApp. DealInSec never
 * sends anything: this only builds a wa.me link with no phone number (WhatsApp asks whom to send it to), so there is
 * no automation, no bulk sending and no WhatsApp Business API.
 *
 * Links in the messages are the ones already made to be given to the client (the quotation's acceptance link, the
 * agreement's signing link); no new token is created and nothing private (PAN, GSTIN, bank details) is added.
 */

/** The wa.me link that opens WhatsApp with `text` ready to edit. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text.slice(0, 1500))}`;
}

const hi = (name?: string | null) => (name?.trim() ? `Hi ${name.trim()},` : "Hi,");

export function quotationMessage(o: { client?: string | null; url: string }): string {
  return `${hi(o.client)}\n\nHere is the quotation for the work we discussed. You can open it and accept it online here:\n${o.url}\n\nHappy to answer any questions.`;
}

export function signingMessage(o: { client?: string | null; url: string }): string {
  return `${hi(o.client)}\n\nThe agreement for our work is ready. You can review and sign it online here (no account needed):\n${o.url}\n\nThank you!`;
}

/** `amount` arrives formatted in the invoice's own currency; `overdue` picks "was due" over "is due". */
export function invoiceReminderMessage(o: { client?: string | null; invoiceNumber: string; amount: string; due?: string | null; overdue?: boolean }): string {
  const when = o.due ? (o.overdue ? `was due on ${o.due}` : `is due on ${o.due}`) : "is still open";
  return `${hi(o.client)}\n\nThis is a gentle reminder that invoice ${o.invoiceNumber} for ${o.amount} ${when}. Please let me know if you need any details or have already made the payment.\n\nThank you!`;
}
