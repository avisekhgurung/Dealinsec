/**
 * Transactional email module — Resend.
 *
 * Branded, table-based HTML (works across all email clients). Each send is
 * best-effort: failures are logged but never throw, so an email outage can't
 * break a payment or contract flow.
 *
 * Required env var:
 *   RESEND_API_KEY
 * Optional:
 *   EMAIL_FROM        (default: "DealInSec <hello@dealinsec.com>")
 *   APP_URL           (used for links/buttons; default https://www.dealinsec.com)
 */
import { Resend } from "resend";

let _resend: Resend | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY!);
  return _resend;
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || "DealInSec <hello@dealinsec.com>";
}

function appUrl(): string {
  return (process.env.APP_URL || "https://www.dealinsec.com").replace(/\/$/, "");
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
}

/** Fire-and-forget send. Never throws — logs and returns false on failure. */
export async function sendEmail({ to, subject, html }: SendArgs): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn(`[email] skipped (RESEND_API_KEY not set): "${subject}" -> ${to}`);
    return false;
  }
  if (!to) return false;
  try {
    await getResend().emails.send({ from: fromAddress(), to, subject, html });
    return true;
  } catch (err) {
    console.error(`[email] send failed: "${subject}" -> ${to}`, err);
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────────
// Shared branded layout
// ───────────────────────────────────────────────────────────────────────

const COLORS = {
  ink: "#0F172A",
  primary: "#0E8C5A",
  accent: "#10B981",
  muted: "#64748B",
  border: "#E5E9EF",
  bg: "#F7F9FB",
  white: "#FFFFFF",
};

function inr(n: number): string {
  return "₹" + Number(n).toLocaleString("en-IN");
}

function layout(opts: { preview: string; bodyHtml: string }): string {
  const base = appUrl();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>DealInSec</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preview}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${COLORS.white};border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0E8C5A 0%,#10B981 100%);padding:22px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:34px;vertical-align:middle;">
                  <div style="width:30px;height:30px;border-radius:8px;background:#FFFFFF;color:#0E8C5A;font-weight:800;font-size:18px;text-align:center;line-height:30px;">D</div>
                </td>
                <td style="vertical-align:middle;padding-left:10px;">
                  <span style="color:#FFFFFF;font-size:18px;font-weight:700;letter-spacing:-0.2px;">DealInSec</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Body -->
        <tr><td style="padding:32px 28px;">${opts.bodyHtml}</td></tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 28px;border-top:1px solid ${COLORS.border};">
            <p style="margin:0 0 6px;color:${COLORS.muted};font-size:12px;line-height:1.5;">
              The deal-management OS for every business.
            </p>
            <p style="margin:0;color:${COLORS.muted};font-size:12px;">
              <a href="${base}" style="color:${COLORS.primary};text-decoration:none;">dealinsec.com</a>
              &nbsp;·&nbsp;
              <a href="mailto:hello@dealinsec.com" style="color:${COLORS.primary};text-decoration:none;">hello@dealinsec.com</a>
            </p>
          </td>
        </tr>
      </table>
      <p style="max-width:520px;margin:16px auto 0;color:#94A3B8;font-size:11px;text-align:center;line-height:1.5;">
        You're receiving this because you have a DealInSec account.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;color:${COLORS.ink};font-size:22px;font-weight:700;letter-spacing:-0.3px;">${text}</h1>`;
}
function para(text: string): string {
  return `<p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6;">${text}</p>`;
}
function button(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr><td style="border-radius:10px;background:linear-gradient(135deg,#0E8C5A 0%,#0D9488 100%);">
    <a href="${href}" style="display:inline-block;padding:12px 24px;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;">${label}</a>
  </td></tr></table>`;
}
function infoRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 0;color:${COLORS.muted};font-size:13px;">${label}</td>
    <td style="padding:8px 0;color:${COLORS.ink};font-size:14px;font-weight:600;text-align:right;">${value}</td>
  </tr>`;
}
function infoCard(rows: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:12px;padding:8px 16px;margin:0 0 20px;">${rows}</table>`;
}

// ───────────────────────────────────────────────────────────────────────
// Templates
// ───────────────────────────────────────────────────────────────────────

export function welcomeEmail(args: { firstName?: string }): { subject: string; html: string } {
  const name = args.firstName ? `, ${args.firstName}` : "";
  const subject = "Welcome to DealInSec — your 3 free credits are ready 🎉";
  const html = layout({
    preview: "Your 3 free contract credits are ready. Here's how to close your first deal.",
    bodyHtml: `
      ${heading(`Welcome aboard${name}!`)}
      ${para("DealInSec helps you track deals, send quotations, sign contracts, and bill clients — all in one workflow.")}
      ${para("You've got <strong>3 free contract credits</strong> to start. Here's your first move:")}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
        <tr><td style="padding:6px 0;color:#334155;font-size:14px;">1️⃣ &nbsp;Create your first deal</td></tr>
        <tr><td style="padding:6px 0;color:#334155;font-size:14px;">2️⃣ &nbsp;Send a professional quotation</td></tr>
        <tr><td style="padding:6px 0;color:#334155;font-size:14px;">3️⃣ &nbsp;Generate a signed agreement (uses 1 credit)</td></tr>
        <tr><td style="padding:6px 0;color:#334155;font-size:14px;">4️⃣ &nbsp;Invoice your client</td></tr>
      </table>
      ${button("Create your first deal", `${appUrl()}/deals/new`)}
      ${para(`Questions? Just reply to this email — we read every one.`)}
    `,
  });
  return { subject, html };
}

export function paymentReceiptEmail(args: {
  firstName?: string;
  credits: number;
  amount: number;
  paymentId: string;
  date: string;
}): { subject: string; html: string } {
  const subject = `Payment received — ${args.credits} credit${args.credits !== 1 ? "s" : ""} added`;
  const html = layout({
    preview: `Your payment of ${inr(args.amount)} was successful. ${args.credits} credit(s) added.`,
    bodyHtml: `
      ${heading("Payment successful ✅")}
      ${para(`Hi${args.firstName ? " " + args.firstName : ""}, your purchase is confirmed and your credits are ready to use.`)}
      ${infoCard(
        infoRow("Amount paid", inr(args.amount)) +
        infoRow("Credits added", `+${args.credits}`) +
        infoRow("Payment ID", args.paymentId) +
        infoRow("Date", args.date),
      )}
      ${button("Go to dashboard", `${appUrl()}/dashboard`)}
      ${para("This email is your receipt. Keep it for your records.")}
    `,
  });
  return { subject, html };
}

export function contractSignedEmail(args: {
  firstName?: string;
  brandName: string;
  contractValue: number;
  contractId: number;
}): { subject: string; html: string } {
  const subject = `Agreement created — ${args.brandName}`;
  const html = layout({
    preview: `Your agreement with ${args.brandName} is signed and ready.`,
    bodyHtml: `
      ${heading("Agreement created ✍️")}
      ${para(`Your contract with <strong>${args.brandName}</strong> has been generated and signed.`)}
      ${infoCard(
        infoRow("Client / Brand", args.brandName) +
        infoRow("Contract value", inr(args.contractValue)),
      )}
      ${button("View agreement", `${appUrl()}/contracts/${args.contractId}`)}
      ${para("You can download the signed PDF and upload a counter-signed proof anytime.")}
    `,
  });
  return { subject, html };
}

export function paymentReceivedEmail(args: {
  firstName?: string;
  brandName: string;
  amount: number;
  invoiceNumber: string;
}): { subject: string; html: string } {
  const subject = `You've been paid — ${inr(args.amount)} from ${args.brandName} 💰`;
  const html = layout({
    preview: `${args.brandName} paid invoice ${args.invoiceNumber}.`,
    bodyHtml: `
      ${heading("You got paid! 💰")}
      ${para(`<strong>${args.brandName}</strong> has paid your invoice. Nice work${args.firstName ? ", " + args.firstName : ""}!`)}
      ${infoCard(
        infoRow("From", args.brandName) +
        infoRow("Invoice", args.invoiceNumber) +
        infoRow("Amount", inr(args.amount)),
      )}
      ${button("View billing", `${appUrl()}/invoices`)}
    `,
  });
  return { subject, html };
}
