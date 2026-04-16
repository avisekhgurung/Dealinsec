import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-background">
      <header className="glass-header sticky top-0 z-40">
        <div className="flex items-center gap-3 px-4 py-4">
          <Link href="/">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <h1 className="text-xl font-bold">Terms of Service</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-2xl mx-auto prose prose-sm dark:prose-invert animate-fade-in">
        <p className="text-muted-foreground text-xs">Last updated: 16 April 2026</p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using InfluDeal ("Platform"), operated by InfluDeal Technologies
          ("Company", "we", "us"), you agree to be bound by these Terms of Service. If you
          do not agree, do not use the Platform.
        </p>

        <h2>2. Eligibility</h2>
        <p>
          You must be at least 18 years old and legally capable of entering into contracts
          under the Indian Contract Act, 1872. By using the Platform, you represent that you
          meet these requirements.
        </p>

        <h2>3. Account Registration</h2>
        <ul>
          <li>You must provide accurate, current, and complete information during registration.</li>
          <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
          <li>You are responsible for all activities that occur under your account.</li>
          <li>Notify us immediately of any unauthorised use of your account.</li>
        </ul>

        <h2>4. Platform Services</h2>
        <p>InfluDeal provides influencer deal management tools including:</p>
        <ul>
          <li><strong>Deal Management</strong> — Create and track brand collaboration deals.</li>
          <li><strong>Quotation Generation</strong> — Generate professional quotations (free).</li>
          <li><strong>Agreement Generation</strong> — Create legally formatted exclusive agreements (requires 1 credit per agreement).</li>
          <li><strong>Invoice Generation</strong> — Generate professional invoices for brands (free).</li>
        </ul>

        <h2>5. Credits & Payments</h2>
        <ul>
          <li>Agreement credits can be purchased via our integrated PayU payment gateway.</li>
          <li>Each credit allows the creation of one exclusive agreement document.</li>
          <li>Credits are non-transferable and tied to your account.</li>
          <li>Credits do not expire.</li>
          <li>All prices are listed in Indian Rupees (INR) and inclusive of applicable taxes.</li>
        </ul>

        <h2>6. User Responsibilities</h2>
        <p>You agree to:</p>
        <ul>
          <li>Use the Platform only for lawful purposes and in compliance with all applicable Indian laws.</li>
          <li>Not impersonate any person or entity or misrepresent your affiliation.</li>
          <li>Not upload harmful, offensive, or illegal content.</li>
          <li>Not attempt to reverse-engineer, hack, or disrupt the Platform.</li>
          <li>Ensure that all deal information, brand details, and financial data you enter are accurate.</li>
        </ul>

        <h2>7. Intellectual Property</h2>
        <p>
          All content, branding, design, code, and materials on the Platform are owned by
          InfluDeal Technologies and protected under the Copyright Act, 1957 and the
          Trade Marks Act, 1999. You may not copy, reproduce, or distribute any part of
          the Platform without our prior written consent.
        </p>

        <h2>8. Limitation of Liability</h2>
        <ul>
          <li>The Platform is provided on an "as-is" and "as-available" basis.</li>
          <li>We do not guarantee uninterrupted or error-free service.</li>
          <li>
            InfluDeal is not a party to any agreement between you and brands. We provide
            tools to generate documents but do not guarantee their legal enforceability.
          </li>
          <li>
            To the maximum extent permitted by law, our total liability shall not exceed
            the amount you have paid us in the preceding 12 months.
          </li>
        </ul>

        <h2>9. Termination</h2>
        <ul>
          <li>You may delete your account at any time by contacting support.</li>
          <li>
            We may suspend or terminate your account if you violate these Terms, engage in
            fraudulent activity, or if required by law.
          </li>
          <li>Upon termination, unused credits are forfeited and non-refundable.</li>
        </ul>

        <h2>10. Dispute Resolution</h2>
        <p>
          Any disputes arising from these Terms shall be subject to the exclusive
          jurisdiction of the courts in Bengaluru, Karnataka, India. Disputes shall first
          be attempted to be resolved through good-faith negotiation for 30 days before
          initiating legal proceedings.
        </p>

        <h2>11. Modifications</h2>
        <p>
          We reserve the right to update these Terms at any time. Continued use of the
          Platform after changes constitutes acceptance of the revised Terms. We will
          notify registered users of material changes via email.
        </p>

        <h2>12. Contact Us</h2>
        <p>
          For questions about these Terms, contact us at:<br />
          <strong>Email:</strong> legal@infludeal.com<br />
          <strong>Address:</strong> InfluDeal Technologies, Bengaluru, Karnataka, India
        </p>
      </main>
    </div>
  );
}
