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
        <p className="text-muted-foreground text-xs">Last updated: 16 April 2026</p>

        <p>
          This Refund Policy applies to all purchases made on InfluDeal ("Platform"),
          operated by InfluDeal Technologies ("Company", "we", "us").
        </p>

        <h2>1. What You Purchase</h2>
        <p>
          On InfluDeal, you purchase <strong>Agreement Credits</strong>. Each credit allows
          you to generate one exclusive influencer marketing agreement document. Credits are
          priced at <strong>₹299 per credit</strong> (or as displayed at the time of purchase).
        </p>

        <h2>2. Refund Eligibility</h2>

        <h3>a) Unused Credits</h3>
        <table>
          <thead>
            <tr><th>Scenario</th><th>Refund</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Credit purchased but NOT yet used to create an agreement</td>
              <td><strong>Full refund</strong> — request within 7 days of purchase</td>
            </tr>
            <tr>
              <td>Credit purchased but NOT yet used, request after 7 days</td>
              <td>No refund, but credit remains valid (credits never expire)</td>
            </tr>
          </tbody>
        </table>

        <h3>b) Used Credits</h3>
        <table>
          <thead>
            <tr><th>Scenario</th><th>Refund</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Credit used to generate an agreement</td>
              <td><strong>No refund</strong> — the digital document has been generated</td>
            </tr>
            <tr>
              <td>Agreement generated but contains an error due to platform bug</td>
              <td><strong>Free replacement credit</strong> granted after verification</td>
            </tr>
          </tbody>
        </table>

        <h3>c) Failed Payments</h3>
        <p>
          If money was debited from your account but the credit was not added (e.g., due to
          a payment gateway error), we will:
        </p>
        <ul>
          <li>Automatically reconcile within 24–48 hours, or</li>
          <li>Process a full refund to your original payment method within 5–7 business days.</li>
        </ul>

        <h2>3. Free Signup Credits</h2>
        <p>
          Credits granted for free upon signup are non-refundable and have no monetary value.
          They cannot be exchanged for cash.
        </p>

        <h2>4. How to Request a Refund</h2>
        <ol>
          <li>Email <strong>support@infludeal.com</strong> with the subject line "Refund Request".</li>
          <li>Include your registered email address and PayU transaction ID.</li>
          <li>We will acknowledge your request within 48 hours.</li>
          <li>Approved refunds are processed within <strong>5–7 business days</strong> to your original payment method.</li>
        </ol>

        <h2>5. Cancellation</h2>
        <p>
          InfluDeal uses a <strong>pay-per-use model</strong> (not a subscription). There is
          no recurring billing to cancel. You simply purchase credits when you need them.
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
          <strong>Email:</strong> support@infludeal.com<br />
          <strong>Response time:</strong> Within 48 hours<br />
          <strong>Address:</strong> InfluDeal Technologies, Bengaluru, Karnataka, India
        </p>
      </main>
    </div>
  );
}
