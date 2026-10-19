import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consentChoice, openConsentSettings } from "@/lib/consent";

export default function CookiePolicy() {
  const [choice, setChoice] = useState(consentChoice());
  useEffect(() => {
    const refresh = () => setChoice(consentChoice());
    window.addEventListener("dis:consent", refresh);
    return () => window.removeEventListener("dis:consent", refresh);
  }, []);
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
        <p className="text-muted-foreground text-xs">Last updated: 16 October 2026</p>

        <p>
          This Cookie Policy explains how DealInSec, a sole proprietorship of Avisekh Gurung ("we", "us") uses cookies
          and similar technologies (such as your browser's local storage) on our website and app.
        </p>

        <div className="not-prose my-4 rounded-xl border p-4">
          <p className="text-sm font-semibold">Your choice</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Analytics on this device: <span className="font-semibold text-foreground" data-testid="cookies-consent-state">{choice === "granted" ? "allowed" : choice === "denied" ? "off" : "not chosen (off)"}</span>.
            Google Analytics only runs if you allow it.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={openConsentSettings} data-testid="cookies-change">Change cookie settings</Button>
        </div>

        <h2>1. What Are Cookies?</h2>
        <p>
          Cookies are small text files stored on your device when you visit a website. Local storage is a similar store
          in your browser that a website can read only on your device. Both help a website remember things between visits.
        </p>

        <h2>2. What We Use</h2>

        <h3>a) Essential (strictly necessary)</h3>
        <table>
          <thead>
            <tr><th>Name</th><th>Purpose</th><th>Duration</th></tr>
          </thead>
          <tbody>
            <tr><td><code>connect.sid</code> (cookie)</td><td>Keeps you signed in</td><td>7 days, or until you sign out</td></tr>
            <tr><td><code>dis_consent</code> (local storage)</td><td>Remembers your analytics choice</td><td>Until you change it; we ask again after 12 months</td></tr>
            <tr><td><code>dis_deal_prefill</code>, <code>dis_audience_intent</code>, <code>dis_chunk_reload</code> (session storage)</td><td>Carry a draft or a choice from the homepage into signup, and recover from an app update</td><td>Until you close the tab</td></tr>
          </tbody>
        </table>
        <p>These are needed for DealInSec to work and are not used for tracking. They can't be switched off here.</p>

        <h3>b) Preferences and convenience (local storage, on this device only)</h3>
        <table>
          <thead>
            <tr><th>Name</th><th>Purpose</th></tr>
          </thead>
          <tbody>
            <tr><td><code>dis_theme</code>, <code>dis-ui-mode</code>, <code>dis-voice-out</code>, <code>dis-voice-barge</code>, <code>dis_nest_sound</code>, <code>dis_nest_welcome_hidden</code>, <code>dis_reply_ratings</code>, <code>dis_last_deal_type</code></td><td>Your theme, the app's view mode, voice and sound settings, the replies you rated, whether you hid The Nest's welcome card, and last deal type</td></tr>
            <tr><td><code>dis_notifications_seen_at</code>, <code>pwa-install-dismissed-at</code>, <code>profileNudgeDismissedAt</code>, <code>dis_first_goal:…</code>, <code>dis_getting_started_dismissed:…</code>, <code>deliverables-done-…</code>, <code>postPaymentRedirect</code></td><td>Which notifications you've seen, prompts you've dismissed, your starting goal and checklist, deliverables you've ticked, and where to return after a payment</td></tr>
          </tbody>
        </table>
        <p>These never leave your device and are not used for tracking. Clearing your browser's site data removes them.</p>

        <h3>c) Analytics (only if you allow it)</h3>
        <p>
          With your permission we use Google Analytics 4 to understand how DealInSec is used: which pages are visited and
          which steps people complete. <strong>Until you choose "Accept analytics", Google Analytics is not loaded at all</strong>,
          so it sets no cookies and receives nothing. If you accept, Google Analytics sets these cookies:
        </p>
        <table>
          <thead>
            <tr><th>Cookie</th><th>Purpose</th><th>Duration</th></tr>
          </thead>
          <tbody>
            <tr><td><code>_ga</code></td><td>Distinguishes visitors</td><td>Up to 2 years</td></tr>
            <tr><td><code>_ga_W3VTLRH79B</code></td><td>Keeps the state of a visit</td><td>Up to 2 years</td></tr>
          </tbody>
        </table>
        <p>
          We send page addresses without document links, record numbers or anything you type, and event details without
          names, emails or message text. If you decline or later change your mind, Google Analytics stays off (or stops
          for the rest of the visit) and we delete its cookies from your browser. Google's handling of this data is
          governed by <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary">Google's Privacy Policy</a>.
        </p>

        <h2>3. Third Parties</h2>
        <ul>
          <li>
            <strong>Google Fonts:</strong> our pages load fonts from Google's servers, so your browser's IP address and
            browser details reach Google when a page loads. We don't set cookies for this.
            See <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary">Google's Privacy Policy</a>.
          </li>
          <li>
            <strong>Razorpay (payments, India):</strong> only when you start paying for a plan, Razorpay's checkout loads
            and may set its own cookies, governed by
            <a href="https://razorpay.com/privacy/" target="_blank" rel="noopener noreferrer" className="text-primary"> Razorpay's Privacy Policy</a>.
          </li>
          <li>
            <strong>Google (sign-in):</strong> if you sign in with Google, Google may set cookies on its own pages during
            sign-in, governed by
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary"> Google's Privacy Policy</a>.
          </li>
        </ul>

        <h2>4. Managing Cookies</h2>
        <p>
          Change your analytics choice at any time with "Change cookie settings" above, in the footer, or in
          Settings → Preferences. You can also clear cookies and site data in your browser:
        </p>
        <ul>
          <li><strong>Chrome:</strong> Settings → Privacy and Security → Cookies</li>
          <li><strong>Safari:</strong> Preferences → Privacy → Manage Website Data</li>
          <li><strong>Firefox:</strong> Settings → Privacy & Security → Cookies</li>
        </ul>
        <p>
          <strong>Note:</strong> Blocking essential cookies will prevent you from signing in.
        </p>

        <h2>5. Changes to This Policy</h2>
        <p>
          We may update this Cookie Policy when we add new tracking technologies. Material
          changes will be communicated via in-app notification.
        </p>

        <h2>6. Contact Us</h2>
        <p>
          For questions about cookies:<br />
          <strong>Email:</strong> support@dealinsec.com<br />
          <strong>Address:</strong> DealInSec (proprietor: Avisekh Gurung), Darjeeling, West Bengal 734101, India
        </p>
      </main>
    </div>
  );
}
