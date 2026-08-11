import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <header className="glass-header sticky top-0 z-40">
        <div className="flex items-center gap-3 px-4 py-4">
          <Link href="/">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <h1 className="text-xl font-bold">Privacy Policy</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-2xl mx-auto prose prose-sm dark:prose-invert animate-fade-in">
        <p className="text-muted-foreground text-xs">Last updated: 10 August 2026</p>

        <p>
          This Privacy Policy explains how DealInSec Technologies ("Company", "we", "us")
          collects, uses, stores, and protects your personal data in compliance with the
          Digital Personal Data Protection Act, 2023 (DPDP Act) and the Information
          Technology Act, 2000.
        </p>

        <h2>1. Data We Collect</h2>

        <h3>a) Information You Provide</h3>
        <ul>
          <li><strong>Account data:</strong> Name, email address, phone number, password (hashed).</li>
          <li><strong>Profile data:</strong> PAN number, GST number, billing address, digital signature image.</li>
          <li><strong>Deal data:</strong> Brand names, deal titles, amounts, deliverables, contract dates.</li>
          <li><strong>Payment data:</strong> Transaction IDs, payment status. We do NOT store credit/debit card numbers — payments are processed securely by Razorpay.</li>
        </ul>

        <h3>b) Information Collected Automatically</h3>
        <ul>
          <li><strong>Usage data:</strong> Pages visited, features used, timestamps.</li>
          <li><strong>Device data:</strong> Browser type, operating system, screen resolution.</li>
          <li><strong>Cookies:</strong> Session cookies for authentication (see our <Link href="/cookies" className="text-primary underline">Cookie Policy</Link>).</li>
        </ul>

        <h2>2. Purpose of Data Collection</h2>
        <p>We collect and process your data for the following purposes:</p>
        <table>
          <thead>
            <tr><th>Purpose</th><th>Legal Basis</th></tr>
          </thead>
          <tbody>
            <tr><td>Account creation and authentication</td><td>Consent &amp; Contract performance</td></tr>
            <tr><td>Generating agreements, quotes, and invoices</td><td>Contract performance</td></tr>
            <tr><td>Processing subscription payments via Razorpay</td><td>Contract performance</td></tr>
            <tr><td>Displaying your profile data on documents</td><td>Consent</td></tr>
            <tr><td>Platform analytics and improvement</td><td>Legitimate interest</td></tr>
            <tr><td>Communication (transactional emails)</td><td>Consent</td></tr>
            <tr><td>Answering your questions and drafting text in DealInSec Copilot (AI)</td><td>Contract performance</td></tr>
          </tbody>
        </table>

        <h2>3. Data Storage & Security</h2>
        <ul>
          <li>Your data is stored in a managed PostgreSQL database (Neon) and served from our application hosting provider (Render).</li>
          <li>Passwords are hashed using industry-standard algorithms (bcrypt).</li>
          <li>All data transmission is encrypted via HTTPS/TLS.</li>
          <li>We implement access controls so only authorised personnel can access your data.</li>
          <li>Digital signatures and uploaded documents are stored securely with access restricted to your account.</li>
        </ul>

        <h2>4. Data Sharing</h2>
        <p>
          We do NOT sell your personal data and we do not share it for advertising. We use the
          following service providers (sub-processors) to run DealInSec, each receiving only the
          data needed for its function:
        </p>
        <table>
          <thead>
            <tr><th>Provider</th><th>Function</th><th>Data shared</th></tr>
          </thead>
          <tbody>
            <tr><td>Razorpay</td><td>Subscription payments</td><td>Name, email, phone, transaction details. Card and bank credentials are entered on Razorpay's own systems — DealInSec never receives or stores them.</td></tr>
            <tr><td>Neon</td><td>Managed PostgreSQL database</td><td>All account and deal data at rest</td></tr>
            <tr><td>Render</td><td>Application hosting</td><td>All data in transit through the application, server logs</td></tr>
            <tr><td>Resend</td><td>Transactional email delivery</td><td>Recipient name, email address, message content</td></tr>
            <tr><td>DeepSeek</td><td>AI model powering DealInSec Copilot</td><td>Your prompt plus the specific deal, invoice and payment records needed to answer it — sent only when you use the Copilot. See Section 5.</td></tr>
          </tbody>
        </table>
        <p>We may also disclose data to law enforcement if required by Indian law or a court order.</p>

        <h2>5. AI Features (DealInSec Copilot)</h2>
        <ul>
          <li>
            DealInSec Copilot is optional. Nothing is sent to our AI provider unless you open the
            Copilot and send a message, or request an AI-generated draft.
          </li>
          <li>
            When you do, your message and the relevant records from your organisation are transmitted to
            DeepSeek for processing and the reply is returned to you. We do not send data belonging to
            other organisations, and the Copilot respects your role permissions.
          </li>
          <li>
            The assistant on our public website is knowledge-only: it has no connection to any account and
            cannot read customer data.
          </li>
          <li>
            AI output may be inaccurate. It is informational, not legal, tax or financial advice.
          </li>
          <li>
            To use DealInSec without any AI processing, simply do not use the Copilot; all other features
            work normally.
          </li>
        </ul>

        <h2>6. Data Retention</h2>
        <ul>
          <li>Account data is retained as long as your account is active.</li>
          <li>Upon account deletion, personal data is erased within 30 days.</li>
          <li>Financial records (invoices, transactions) are retained for 8 years as required under the Income Tax Act, 1961.</li>
        </ul>

        <h2>7. Your Rights (under DPDP Act)</h2>
        <p>As a Data Principal, you have the right to:</p>
        <ul>
          <li><strong>Access:</strong> Download a complete copy of your account data as JSON at any time — Settings → Your data → Download my data.</li>
          <li><strong>Correction:</strong> Request correction of inaccurate data.</li>
          <li><strong>Erasure:</strong> Delete your account and its data from Settings → Your data → Delete my account. Financial records are retained for the statutory period in Section 6.</li>
          <li><strong>Withdraw Consent:</strong> Withdraw consent for data processing at any time.</li>
          <li><strong>Grievance Redressal:</strong> File a complaint with our Grievance Officer (details below).</li>
        </ul>

        <h2>8. Children's Data</h2>
        <p>
          DealInSec is not intended for users under 18 years of age. We do not knowingly
          collect data from minors. If we become aware of such data, we will delete it promptly.
        </p>

        <h2>9. Cross-Border Data Transfer</h2>
        <p>
          Some of the providers listed in Section 4 — including our hosting, database, email and AI
          providers — operate infrastructure outside India, so your data may be processed abroad. We
          transfer data only to providers bound by their own data-protection commitments, only for the
          functions described above, and in accordance with the DPDP Act, 2023.
        </p>

        <h2>10. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you via email
          or in-app notification of material changes. Continued use of the Platform after
          changes constitutes acceptance.
        </p>

        <h2>11. Grievance Officer</h2>
        <p>
          In accordance with Section 13 of the DPDP Act and Rule 5(9) of the IT Rules, 2011:<br />
          <strong>Name:</strong> Avisekh Gurung, Grievance Officer<br />
          <strong>Email:</strong> support@dealinsec.com<br />
          <strong>Response time:</strong> Within 72 hours of receiving a complaint.
        </p>

        <h2>12. Contact Us</h2>
        <p>
          For privacy-related queries:<br />
          <strong>Email:</strong> support@dealinsec.com<br />
          <strong>Address:</strong> DealInSec Technologies, Bengaluru, Karnataka, India
        </p>
      </main>
    </div>
  );
}
