/**
 * Payment Chaser: the AI drafts the words, the NUMBERS come from the row.
 * Never sends anything — the user copies the message themselves.
 *
 * Shared by POST /api/copilot/chaser and the agent's draft_payment_followup.
 */
import { formatDate, formatMoney } from "@shared/money";
import type { BrandInvoice, User } from "@shared/schema";
import { aiProvider } from "./provider";
import { copilotSettings } from "./workflow";
import { chaserSystemPrompt, chaserToneFor, chaserTones, voiceFor } from "./voice";

export async function draftChaserMessage(user: User, invoice: BrandInvoice, requestedTone: unknown) {
  const settings = await copilotSettings(user);
  const voice = voiceFor(settings.country);
  const tones = chaserTones(voice);
  const tone = chaserToneFor(voice, requestedTone);
  const now = Date.now();
  const due = invoice.dueDate ? new Date(invoice.dueDate as any) : null;
  const daysOverdue = due ? Math.floor((now - due.getTime()) / 86_400_000) : null;
  const facts = [
    `Recipient (address the message TO this client): ${invoice.brandName}`,
    `Invoice number: ${invoice.invoiceNumber}`,
    // Formatted here, from the row — the model copies this string, it never
    // does arithmetic or picks a currency.
    `Amount: ${formatMoney(invoice.dealAmountMinor, settings.currency, settings.locale)}`,
    due
      ? `Due date: ${formatDate(invoice.dueDate, settings.locale, { day: "numeric", month: "long", year: false, timezone: settings.timezone })}`
      : "No due date on record",
    daysOverdue !== null && daysOverdue > 0 ? `Days overdue: ${daysOverdue}` : "Not yet overdue",
    `Sender (sign off as this person — never greet them): ${user.firstName ?? "the business owner"}`,
  ].join("\n");
  const result = await aiProvider.chat([
    { role: "system", content: chaserSystemPrompt(voice, tone) },
    { role: "user", content: facts },
  ], []);
  // `tones` travels with every draft so the client never keeps its own country
  // table: whatever the retone row offers, this route accepts.
  return { message: result.content ?? "", tone, tones, invoiceNumber: invoice.invoiceNumber };
}
