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
 *   EMAIL_FROM        (default: "DealInSec <support@dealinsec.com>")
 *   APP_URL           (used for links/buttons; default https://www.dealinsec.com)
 */
import { Resend } from "resend";
import { getLocaleSettings, toMinor, type LocaleFields } from "@shared/schema";
import { formatMoney } from "@shared/money";

let _resend: Resend | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY!);
  return _resend;
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || "DealInSec <support@dealinsec.com>";
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

/**
 * Money in an email is written exactly as it is written in the app and on the
 * PDF — same formatter, same rules. The receipt a user forwards to their
 * accountant must match the invoice it is a receipt for.
 *
 * `locale` is optional and omitting it means India, which is what every row
 * held before the expansion: a caller that hasn't been taught to pass the
 * organisation's settings yet keeps sending exactly the email it sends today.
 */
function money(minor: number, locale?: LocaleFields | null): string {
  const s = getLocaleSettings(locale);
  return formatMoney(minor, s.currency, s.locale);
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
              <a href="mailto:support@dealinsec.com" style="color:${COLORS.primary};text-decoration:none;">support@dealinsec.com</a>
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

export function inviteEmail(args: {
  orgName: string;
  inviterName: string;
  roleLabel: string;
  token: string;
  /** The inviting org's own country — known at the call site (req.org),
   *  unlike welcomeEmail's pre-onboarding moment. "GST invoices" only means
   *  anything to an Indian org; everywhere else it's just "invoices". */
  country?: string | null;
}): { subject: string; html: string } {
  const acceptUrl = `${appUrl()}/invite/${args.token}`;
  const subject = `You've been invited to join ${args.orgName} on DealInSec`;
  const invoiceWord = args.country === "IN" ? "GST invoices" : "invoices";
  const html = layout({
    preview: `${args.inviterName} invited you to join ${args.orgName} as ${args.roleLabel}.`,
    bodyHtml: `
      ${heading(`Join ${args.orgName} on DealInSec`)}
      ${para(`<strong>${args.inviterName}</strong> has invited you to join <strong>${args.orgName}</strong> as <strong>${args.roleLabel}</strong>.`)}
      ${para(`DealInSec is where the team runs its deals — quotations, e-signed agreements, ${invoiceWord} and payment tracking in one workflow.`)}
      ${button("Accept Invitation", acceptUrl)}
      ${para("You'll set a password and land right inside the organization. This invitation expires in 7 days.")}
      ${para("Didn't expect this? You can safely ignore this email.")}
    `,
  });
  return { subject, html };
}

export function welcomeEmail(args: { firstName?: string }): { subject: string; html: string } {
  // Fires at SIGNUP — before onboarding finishes, i.e. before the 7-day
  // trial is granted — so the copy has to work for both outcomes: it sells
  // the trial ("finish setup to unlock") without promising it
  // unconditionally, and never mentions credit counts (invited members and
  // trial-ineligible accounts see this too).
  const name = args.firstName ? `, ${args.firstName}` : "";
  const subject = "Welcome to DealInSec — let's close your first deal 🎉";
  const html = layout({
    preview: "Finish setting up and every Pro feature is unlocked free for 7 days.",
    bodyHtml: `
      ${heading(`Welcome aboard${name}!`)}
      ${para("DealInSec helps you track deals, send quotations, sign agreements, and bill clients — all in one workflow.")}
      ${para("Finish setting up your account and you'll get a <strong>7-day Pro trial</strong> — agreements, invoices and payment tracking, all unlocked. Here's your first move:")}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
        <tr><td style="padding:6px 0;color:#334155;font-size:14px;">1️⃣ &nbsp;Create your first deal</td></tr>
        <tr><td style="padding:6px 0;color:#334155;font-size:14px;">2️⃣ &nbsp;Send a professional quotation</td></tr>
        <tr><td style="padding:6px 0;color:#334155;font-size:14px;">3️⃣ &nbsp;Sign the agreement &amp; raise the invoice</td></tr>
        <tr><td style="padding:6px 0;color:#334155;font-size:14px;">4️⃣ &nbsp;Track payments until you're paid</td></tr>
      </table>
      ${button("Create your first deal", `${appUrl()}/deals/new`)}
      ${para(`Questions? Just reply to this email — we read every one.`)}
    `,
  });
  return { subject, html };
}

export function passwordResetEmail(args: {
  firstName?: string;
  email: string;
  token: string;
}): { subject: string; html: string } {
  const name = args.firstName ? `, ${args.firstName}` : "";
  const resetUrl = `${appUrl()}/reset-password?email=${encodeURIComponent(args.email)}&token=${encodeURIComponent(args.token)}`;
  const subject = "Reset your DealInSec password";
  const html = layout({
    preview: "Set a new password — this link is valid for 30 minutes.",
    bodyHtml: `
      ${heading(`Reset your password${name}`)}
      ${para("We received a request to reset the password for your DealInSec account. Click below to set a new one — the link is valid for <strong>30 minutes</strong>.")}
      ${button("Set a new password", resetUrl)}
      ${para("If the button doesn't work, copy this link into your browser:")}
      ${para(`<a href="${resetUrl}" style="color:#059669;word-break:break-all;">${resetUrl}</a>`)}
      ${para("Didn't request this? You can safely ignore this email — your password stays unchanged.")}
    `,
  });
  return { subject, html };
}

// ── DealInSec's OWN billing (not the user's money) ─────────────────────
// These two receipts are for what the user paid US, on the India-only
// Razorpay rail. `payu_orders.amount` is whole rupees and was deliberately
// left out of the minor-units migration (server/routes.ts multiplies it by
// 100 when it hands the order to Razorpay — that IS the conversion), so the
// unit is in the parameter name and the conversion happens here, once.

export function paymentReceiptEmail(args: {
  firstName?: string;
  product: string;
  /** Whole rupees, straight off payu_orders.amount. */
  amountRupees: number;
  paymentId: string;
  date: string;
}): { subject: string; html: string } {
  const paid = money(toMinor(args.amountRupees, "INR"));
  const subject = `Payment received — ${args.product}`;
  const html = layout({
    preview: `Your payment of ${paid} was successful.`,
    bodyHtml: `
      ${heading("Payment successful ✅")}
      ${para(`Hi${args.firstName ? " " + args.firstName : ""}, your purchase is confirmed and ready to use.`)}
      ${infoCard(
        infoRow("Purchase", args.product) +
        infoRow("Amount paid", paid) +
        infoRow("Payment ID", args.paymentId) +
        infoRow("Date", args.date),
      )}
      ${button("Go to dashboard", `${appUrl()}/dashboard`)}
      ${para("This email is your receipt. Keep it for your records.")}
    `,
  });
  return { subject, html };
}

export function proPlanReceiptEmail(args: {
  firstName?: string;
  /** Whole rupees, straight off payu_orders.amount. */
  amountRupees: number;
  paymentId: string;
  date: string;
  term: "monthly" | "yearly";
  expiresOn: string;
}): { subject: string; html: string } {
  const paid = money(toMinor(args.amountRupees, "INR"));
  const termLabel = args.term === "monthly" ? "Monthly" : "1 year";
  const covered = args.term === "monthly" ? "this month" : "the next year";
  const subject = "Welcome to DealInSec Pro — the full workflow is unlocked";
  const html = layout({
    preview: `Your payment of ${paid} was successful. DealInSec Pro is now active.`,
    bodyHtml: `
      ${heading("You're on Pro 🎉")}
      ${para(`Hi${args.firstName ? " " + args.firstName : ""}, your DealInSec Pro plan is active. Unlimited deals, quotations, agreements and invoices for ${covered} — plus payment tracking.`)}
      ${infoCard(
        infoRow("Plan", `DealInSec Pro — ${termLabel}`) +
        infoRow("Workflow", "Unlimited") +
        infoRow("Amount paid", paid) +
        (args.expiresOn ? infoRow("Valid until", args.expiresOn) : "") +
        infoRow("Payment ID", args.paymentId) +
        infoRow("Date", args.date),
      )}
      ${button("Go to dashboard", `${appUrl()}/dashboard`)}
      ${para("Plans are one-time payments — nothing auto-renews. This email is your receipt.")}
    `,
  });
  return { subject, html };
}

// ── The USER's money ───────────────────────────────────────────────────
// Minor units, formatted in the ORGANISATION's currency — the same locale
// the agreement and the invoice were printed in. Pass
// resolveLocaleSettings(org, user); omitting it means India.

export function quoteAcceptedEmail(args: {
  firstName?: string;
  clientName: string;
  dealTitle: string;
  amountMinor: number;
  dealId: number;
  locale?: LocaleFields | null;
}): { subject: string; html: string } {
  const subject = `${args.clientName} accepted your quotation`;
  const html = layout({
    preview: `${args.clientName} accepted the quotation for ${args.dealTitle}.`,
    bodyHtml: `
      ${heading("Quotation accepted ✅")}
      ${para(`<strong>${args.clientName}</strong> accepted your quotation for <strong>${args.dealTitle}</strong>.`)}
      ${infoCard(
        infoRow("Client", args.clientName) +
        infoRow("Project", args.dealTitle) +
        infoRow("Amount", money(args.amountMinor, args.locale)),
      )}
      ${button("Open deal", `${appUrl()}/deals/${args.dealId}`)}
      ${para("This confirms interest, not a signed agreement — create the agreement next when you're ready to start.")}
    `,
  });
  return { subject, html };
}

export function agreementSignedByClientEmail(args: {
  firstName?: string;
  clientName: string;
  contractName: string;
  amountMinor: number;
  contractId: number;
  signerName: string;
  locale?: LocaleFields | null;
}): { subject: string; html: string } {
  const subject = `${args.clientName} signed your agreement`;
  const html = layout({
    preview: `${args.signerName} signed ${args.contractName} online.`,
    bodyHtml: `
      ${heading("Agreement signed ✍️")}
      ${para(`<strong>${args.signerName}</strong>, on behalf of <strong>${args.clientName}</strong>, signed your agreement online.`)}
      ${infoCard(
        infoRow("Agreement", args.contractName) +
        infoRow("Signed by", args.signerName) +
        infoRow("Value", money(args.amountMinor, args.locale)),
      )}
      ${button("View agreement", `${appUrl()}/contracts/${args.contractId}`)}
      ${para(`This is electronic acceptance with an audit record — who signed, when, and which signature was used — not ${
        args.locale?.country === "IN" ? "a Digital Signature Certificate" : "a certificate-based digital signature"
      }. You can generate the invoice next.`)}
    `,
  });
  return { subject, html };
}

export function contractSignedEmail(args: {
  firstName?: string;
  brandName: string;
  contractValueMinor: number;
  contractId: number;
  locale?: LocaleFields | null;
}): { subject: string; html: string } {
  const subject = `Agreement created — ${args.brandName}`;
  const html = layout({
    preview: `Your agreement with ${args.brandName} is signed and ready.`,
    bodyHtml: `
      ${heading("Agreement created ✍️")}
      ${para(`Your contract with <strong>${args.brandName}</strong> has been generated and signed.`)}
      ${infoCard(
        infoRow("Client / Brand", args.brandName) +
        infoRow("Contract value", money(args.contractValueMinor, args.locale)),
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
  amountMinor: number;
  invoiceNumber: string;
  locale?: LocaleFields | null;
}): { subject: string; html: string } {
  const received = money(args.amountMinor, args.locale);
  const subject = `You've been paid — ${received} from ${args.brandName} 💰`;
  const html = layout({
    preview: `${args.brandName} paid invoice ${args.invoiceNumber}.`,
    bodyHtml: `
      ${heading("You got paid! 💰")}
      ${para(`<strong>${args.brandName}</strong> has paid your invoice. Nice work${args.firstName ? ", " + args.firstName : ""}!`)}
      ${infoCard(
        infoRow("From", args.brandName) +
        infoRow("Invoice", args.invoiceNumber) +
        infoRow("Amount", received),
      )}
      ${button("View billing", `${appUrl()}/invoices`)}
    `,
  });
  return { subject, html };
}
