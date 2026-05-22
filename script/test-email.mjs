/**
 * Manual email test — surfaces the real Resend error.
 *
 * Usage:
 *   node --env-file=.env script/test-email.mjs you@example.com
 *
 * (Node 20+ required for --env-file. Use Homebrew node: PATH=/opt/homebrew/bin:$PATH)
 */
import { Resend } from "resend";

const to = process.argv[2];
if (!to) {
  console.error("❌ Usage: node --env-file=.env script/test-email.mjs you@example.com");
  process.exit(1);
}

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM || "DealInSec <support@dealinsec.com>";

console.log("──────────────────────────────────────────");
console.log("RESEND_API_KEY present:", apiKey ? `yes (${apiKey.slice(0, 8)}…)` : "❌ NO");
console.log("EMAIL_FROM:", from);
console.log("Sending to:", to);
console.log("──────────────────────────────────────────");

if (!apiKey) {
  console.error("❌ RESEND_API_KEY not found in .env — add it and retry.");
  process.exit(1);
}

const resend = new Resend(apiKey);

try {
  const result = await resend.emails.send({
    from,
    to,
    subject: "DealInSec test email ✅",
    html: "<h2>It works!</h2><p>If you're reading this, Resend is configured correctly.</p>",
  });
  if (result.error) {
    console.error("❌ Resend returned an error:");
    console.error(JSON.stringify(result.error, null, 2));
  } else {
    console.log("✅ SENT! Email id:", result.data?.id);
    console.log("Check the inbox of:", to);
  }
} catch (err) {
  console.error("❌ Send threw an exception:");
  console.error(err);
}
