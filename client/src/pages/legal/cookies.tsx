import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CookiePolicy() {
  return (
    <div className="min-h-screen bg-background">
      <header className="glass-header sticky top-0 z-40">
        <div className="flex items-center gap-3 px-4 py-4">
          <Link href="/">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <h1 className="text-xl font-bold">Cookie Policy</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-2xl mx-auto prose prose-sm dark:prose-invert animate-fade-in">
        <p className="text-muted-foreground text-xs">Last updated: 16 April 2026</p>

        <p>
          This Cookie Policy explains how InfluDeal Technologies ("we", "us") uses cookies
          and similar tracking technologies on our platform.
        </p>

        <h2>1. What Are Cookies?</h2>
        <p>
          Cookies are small text files stored on your device when you visit a website. They
          help the website remember your preferences and improve your experience.
        </p>

        <h2>2. Types of Cookies We Use</h2>

        <h3>a) Essential Cookies (Strictly Necessary)</h3>
        <table>
          <thead>
            <tr><th>Cookie</th><th>Purpose</th><th>Duration</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code>connect.sid</code></td>
              <td>Session authentication — keeps you logged in</td>
              <td>24 hours (or until logout)</td>
            </tr>
          </tbody>
        </table>
        <p>
          These cookies are required for the Platform to function. Without them, you cannot
          log in or use authenticated features. They cannot be disabled.
        </p>

        <h3>b) Functional Cookies</h3>
        <table>
          <thead>
            <tr><th>Cookie / Storage</th><th>Purpose</th><th>Duration</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code>postPaymentRedirect</code> (localStorage)</td>
              <td>Remembers where to redirect you after completing a payment</td>
              <td>Cleared after use</td>
            </tr>
          </tbody>
        </table>

        <h3>c) Analytics Cookies</h3>
        <p>
          We currently do not use third-party analytics cookies. If we add analytics
          tracking in the future (e.g., Google Analytics), we will update this policy
          and request your consent.
        </p>

        <h2>3. Third-Party Cookies</h2>
        <ul>
          <li>
            <strong>PayU (Payment Gateway):</strong> When you are redirected to PayU for
            payment, PayU may set its own cookies. These are governed by
            <a href="https://www.payu.in/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary"> PayU's Privacy Policy</a>.
          </li>
          <li>
            <strong>Google (OAuth Sign-In):</strong> If you sign in with Google, Google may
            set cookies during the authentication flow. These are governed by
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary"> Google's Privacy Policy</a>.
          </li>
        </ul>

        <h2>4. Managing Cookies</h2>
        <p>You can control cookies through your browser settings:</p>
        <ul>
          <li><strong>Chrome:</strong> Settings → Privacy and Security → Cookies</li>
          <li><strong>Safari:</strong> Preferences → Privacy → Manage Website Data</li>
          <li><strong>Firefox:</strong> Settings → Privacy & Security → Cookies</li>
        </ul>
        <p>
          <strong>Note:</strong> Disabling essential cookies will prevent you from using the
          Platform's authenticated features.
        </p>

        <h2>5. Changes to This Policy</h2>
        <p>
          We may update this Cookie Policy when we add new tracking technologies. Material
          changes will be communicated via in-app notification.
        </p>

        <h2>6. Contact Us</h2>
        <p>
          For questions about cookies:<br />
          <strong>Email:</strong> privacy@infludeal.com<br />
          <strong>Address:</strong> InfluDeal Technologies, Bengaluru, Karnataka, India
        </p>
      </main>
    </div>
  );
}
