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
        <p className="text-muted-foreground text-xs">Last updated: 16 April 2026</p>

        <p>
          This Privacy Policy explains how InfluDeal Technologies ("Company", "we", "us")
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
          <li><strong>Payment data:</strong> Transaction IDs, payment status. We do NOT store credit/debit card numbers — payments are processed securely by PayU.</li>
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
            <tr><td>Processing payments via PayU</td><td>Contract performance</td></tr>
            <tr><td>Displaying your profile data on documents</td><td>Consent</td></tr>
            <tr><td>Platform analytics and improvement</td><td>Legitimate interest</td></tr>
            <tr><td>Communication (transactional emails)</td><td>Consent</td></tr>
          </tbody>
        </table>

        <h2>3. Data Storage & Security</h2>
        <ul>
          <li>Your data is stored on secure cloud servers (PostgreSQL database hosted on Railway/AWS).</li>
          <li>Passwords are hashed using industry-standard algorithms (bcrypt).</li>
          <li>All data transmission is encrypted via HTTPS/TLS.</li>
          <li>We implement access controls so only authorised personnel can access your data.</li>
          <li>Digital signatures and uploaded documents are stored securely with access restricted to your account.</li>
        </ul>

        <h2>4. Data Sharing</h2>
        <p>We do NOT sell your personal data. We may share data with:</p>
        <ul>
          <li><strong>PayU (payment processor):</strong> Name, email, phone, and transaction details for payment processing.</li>
          <li><strong>Google (if using Google Sign-In):</strong> Authentication only — we receive your name and email.</li>
          <li><strong>Law enforcement:</strong> If required by Indian law or court order.</li>
        </ul>

        <h2>5. Data Retention</h2>
        <ul>
          <li>Account data is retained as long as your account is active.</li>
          <li>Upon account deletion, personal data is erased within 30 days.</li>
          <li>Financial records (invoices, transactions) are retained for 8 years as required under the Income Tax Act, 1961.</li>
        </ul>

        <h2>6. Your Rights (under DPDP Act)</h2>
        <p>As a Data Principal, you have the right to:</p>
        <ul>
          <li><strong>Access:</strong> Request a copy of your personal data.</li>
          <li><strong>Correction:</strong> Request correction of inaccurate data.</li>
          <li><strong>Erasure:</strong> Request deletion of your data (subject to legal retention requirements).</li>
          <li><strong>Withdraw Consent:</strong> Withdraw consent for data processing at any time.</li>
          <li><strong>Grievance Redressal:</strong> File a complaint with our Grievance Officer (details below).</li>
        </ul>

        <h2>7. Children's Data</h2>
        <p>
          InfluDeal is not intended for users under 18 years of age. We do not knowingly
          collect data from minors. If we become aware of such data, we will delete it promptly.
        </p>

        <h2>8. Cross-Border Data Transfer</h2>
        <p>
          Your data may be processed on servers located outside India (e.g., cloud hosting
          providers). We ensure that any such transfer complies with the DPDP Act and that
          adequate safeguards are in place.
        </p>

        <h2>9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you via email
          or in-app notification of material changes. Continued use of the Platform after
          changes constitutes acceptance.
        </p>

        <h2>10. Grievance Officer</h2>
        <p>
          In accordance with Section 13 of the DPDP Act and Rule 5(9) of the IT Rules, 2011:<br />
          <strong>Name:</strong> Grievance Officer, InfluDeal Technologies<br />
          <strong>Email:</strong> grievance@infludeal.com<br />
          <strong>Response time:</strong> Within 72 hours of receiving a complaint.
        </p>

        <h2>11. Contact Us</h2>
        <p>
          For privacy-related queries:<br />
          <strong>Email:</strong> privacy@infludeal.com<br />
          <strong>Address:</strong> InfluDeal Technologies, Bengaluru, Karnataka, India
        </p>
      </main>
    </div>
  );
}
