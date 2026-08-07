import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function RefundPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <header className="glass-header sticky top-0 z-40">
        <div className="flex items-center gap-3 px-4 py-4">
          <Link href="/">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <h1 className="text-xl font-bold">Refund Policy</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-2xl mx-auto prose prose-sm dark:prose-invert animate-fade-in">
        <p className="text-muted-foreground text-xs">Last updated: 24 July 2026</p>

        <p>
          This Refund Policy applies to all purchases made on DealInSec ("Platform"),
          operated by DealInSec Technologies ("Company", "we", "us").
        </p>

        <h2>1. What You Purchase</h2>
        <p>
          DealInSec offers the following paid products (prices as displayed at the time
          of purchase):
        </p>
        <ul>
          <li><strong>DealInSec Pro — Monthly (₹999)</strong>: the full workflow (unlimited deals, quotations, agreements, invoices and payment tracking) for 1 month.</li>
          <li><strong>DealInSec Pro — Annual (₹9,999)</strong>: the same, for 1 year.</li>
          <li><strong>Deal Boost (₹99)</strong>: unlimited deals and quotations for 1 month (does not include agreements, invoices or payment tracking).</li>
        </ul>
        <p>
          All plans are <strong>one-time payments</strong> for a fixed term. Nothing
          auto-renews and no auto-debit mandate is created.
        </p>

        <h2>2. Refund Eligibility</h2>
        <table>
          <thead>
            <tr><th>Scenario</th><th>Refund</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Plan purchased but the paid features have NOT been used (no agreement or invoice generated during the term)</td>
              <td><strong>Full refund</strong> — request within 7 days of purchase</td>
            </tr>
            <tr>
              <td>Plan purchased and paid features have been used</td>
              <td><strong>No refund</strong> — the service has been consumed</td>
            </tr>
            <tr>
              <td>A document generated with a paid feature contains an error caused by a platform bug</td>
              <td><strong>Term extension or replacement</strong> granted after verification</td>
            </tr>
          </tbody>
        </table>
        <p>
          When a refund is processed, the corresponding plan term (or Deal Boost) is
          revoked from the account.
        </p>

        <h3>Failed Payments</h3>
        <p>
          If money was debited from your account but your plan was not activated (e.g., due
          to a payment gateway error), we will:
        </p>
        <ul>
          <li>Automatically reconcile within 24–48 hours, or</li>
          <li>Process a full refund to your original payment method within 5–7 business days.</li>
        </ul>

        <h2>3. Free Plan Allowance</h2>
        <p>
          The free plan's monthly allowance of 4 deals is granted at no charge, is
          non-refundable, has no monetary value, and cannot be exchanged for cash.
          Unused monthly allowance does not roll over.
        </p>

        <h2>4. How to Request a Refund</h2>
        <ol>
          <li>Email <strong>support@dealinsec.com</strong> with the subject line "Refund Request".</li>
          <li>Include your registered email address and Razorpay payment ID.</li>
          <li>We will acknowledge your request within 48 hours.</li>
          <li>Approved refunds are processed within <strong>5–7 business days</strong> to your original payment method.</li>
        </ol>

        <h2>5. Cancellation</h2>
        <p>
          Plans are <strong>one-time payments for a fixed term</strong> — there is no
          recurring billing to cancel. Your plan simply ends at the end of its term unless
          you choose to renew, and your account then returns to the free plan.
        </p>

        <h2>6. Chargebacks</h2>
        <p>
          If you initiate a chargeback/dispute with your bank without first contacting us,
          we reserve the right to suspend your account pending investigation. We encourage
          you to reach out to us first — we are committed to resolving issues quickly.
        </p>

        <h2>7. Contact Us</h2>
        <p>
          For refund-related queries:<br />
          <strong>Email:</strong> support@dealinsec.com<br />
          <strong>Response time:</strong> Within 48 hours<br />
          <strong>Address:</strong> DealInSec Technologies, Bengaluru, Karnataka, India
        </p>
      </main>
    </div>
  );
}
