/**
 * Dedicated authentication page — replaces the landing-page popup.
 *
 * Split-screen on desktop: an elevated form card on the left, the emerald
 * brand panel on the right (the real 4-step workflow, matching the splash
 * screen). On mobile the brand panel becomes a compact gradient hero above the
 * card, so signing in on a phone still feels like the product rather than a
 * bare form. Mode comes from ?mode=signin|signup and is toggleable in place.
 *
 * Copy rule: every claim on this page has to be true. No certification we do
 * not hold, no customer count we have not reached, and nothing about
 * signatures that contradicts the execution record on the agreement itself
 * (see ESIGN_RECOMMENDATION.md).
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2, Briefcase, FileText, FileCheck, Receipt, Check, ArrowLeft, Eye, EyeOff,
  Mail, Lock, ShieldCheck, KeyRound, Users, Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { DealinsecLogo } from "@/components/dealinsec-logo";
import { trackEvent } from "@/lib/analytics";

const PIPELINE = [
  { icon: Briefcase, label: "Deal" },
  { icon: FileText, label: "Quotation" },
  { icon: FileCheck, label: "Agreement" },
  { icon: Receipt, label: "Invoice" },
];

const PROOF_POINTS = [
  "Agreements carry a signed execution record",
  "No credit card required",
  "Built for India's deal-led businesses",
  "7-day Pro trial — everything unlocked",
];

/** Security facts, each one verifiable in the code — see PRIVACY policy §3. */
const TRUST_STRIP = [
  { icon: Lock, title: "Encrypted in transit", sub: "Every request over HTTPS" },
  { icon: KeyRound, title: "Passwords hashed", sub: "bcrypt — never stored plain" },
  { icon: Users, title: "Role-based access", sub: "You control who sees what" },
];

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">(() => {
    try {
      return new URLSearchParams(window.location.search).get("mode") === "signin"
        ? "signin"
        : "signup";
    } catch {
      return "signup";
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  useEffect(() => {
    if (isAuthenticated) setLocation("/dashboard");
  }, [isAuthenticated, setLocation]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (mode === "signup") {
        await apiRequest("POST", "/api/auth/signup", { email, password, firstName, lastName });
        trackEvent("sign_up", { method: "email" });
      } else {
        await apiRequest("POST", "/api/auth/login", { email, password });
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/dashboard");
    } catch (error: any) {
      toast({
        title: mode === "signup" ? "Signup failed" : "Sign in failed",
        description: error.message || (mode === "signup" ? "Could not create account" : "Invalid email or password"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1fr_1.05fr] bg-muted/40 dark:bg-background">

      {/* ══ Mobile brand hero — the desktop panel, compressed ══ */}
      <div
        className="lg:hidden relative overflow-hidden px-5 pt-6 pb-16 text-white"
        style={{
          background:
            "radial-gradient(120% 90% at 15% 0%, hsl(160 84% 26%) 0%, hsl(160 84% 18%) 48%, hsl(174 60% 12%) 100%)",
        }}
      >
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-white/5" aria-hidden="true" />
        <div className="relative flex items-center justify-between">
          <DealinsecLogo size="sm" className="[&_*]:!text-white" />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-100/80 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to site
          </Link>
        </div>

        <div className="relative mt-7">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300 mb-2">
            Deal · Sign · Secured
          </p>
          <h2 className="text-[26px] leading-[1.15] font-bold tracking-tight">
            Get every deal in writing.<br />
            <span className="text-emerald-300">And get paid on time.</span>
          </h2>

          <div className="flex items-center gap-1 mt-5">
            {PIPELINE.map(({ icon: Icon, label }, i) => (
              <div key={label} className="flex items-center gap-1 min-w-0">
                {i > 0 && <span className="w-3 h-px bg-emerald-400/40 shrink-0" aria-hidden="true" />}
                <div className="flex flex-col items-center gap-1">
                  <span className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center">
                    <Icon className="w-3.5 h-3.5 text-emerald-200" strokeWidth={2} />
                  </span>
                  <span className="text-[9px] font-semibold text-emerald-100/80">{label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══ Form side ══ */}
      <div className="relative flex flex-col lg:px-10 xl:px-16 lg:py-8">
        {/* Faint dotted texture behind the card (desktop only) */}
        <div
          className="hidden lg:block absolute inset-0 opacity-[0.35] dark:opacity-[0.12] pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            color: "hsl(var(--muted-foreground))",
            maskImage: "radial-gradient(70% 60% at 50% 40%, black, transparent)",
            WebkitMaskImage: "radial-gradient(70% 60% at 50% 40%, black, transparent)",
          }}
        />

        <div className="relative flex-1 flex items-center justify-center px-4 pb-8 -mt-10 lg:mt-0 lg:px-0 lg:py-6">
          <div className="w-full max-w-[460px]">
            <div className="rounded-2xl border border-border bg-card shadow-xl shadow-black/5 dark:shadow-black/40 p-6 sm:p-8">

              {/* Card header — desktop keeps logo + back link here */}
              <div className="hidden lg:flex items-center justify-between mb-8">
                <Link href="/" className="inline-flex" aria-label="Back to home">
                  <DealinsecLogo size="sm" />
                </Link>
                <Link
                  href="/"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to site
                </Link>
              </div>

              <h1 className="text-2xl font-bold tracking-tight" data-testid="auth-heading">
                {mode === "signup" ? "Create your account" : "Welcome back"}
                <span className="ml-1.5" aria-hidden="true">{mode === "signup" ? "✨" : "👋"}</span>
              </h1>
              <p className="text-sm text-muted-foreground mt-1.5 mb-6">
                {mode === "signup"
                  ? "No credit card. Every Pro feature free for 7 days."
                  : "Sign in to continue to your workspace."}
              </p>

              <Button
                type="button"
                variant="outline"
                className="w-full h-12 rounded-xl font-semibold"
                onClick={() => { window.location.href = "/api/auth/google"; }}
                data-testid="button-google"
              >
                <GoogleIcon />
                <span className="ml-2">Continue with Google</span>
              </Button>

              <div className="flex items-center gap-3 my-5" aria-hidden="true">
                <span className="flex-1 h-px bg-border" />
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">or</span>
                <span className="flex-1 h-px bg-border" />
              </div>

              <form onSubmit={submit} className="space-y-4">
                {mode === "signup" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="auth-first">First name</Label>
                      <Input
                        id="auth-first"
                        className="h-12 rounded-xl"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="Meera"
                        data-testid="input-first-name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="auth-last">Last name</Label>
                      <Input
                        id="auth-last"
                        className="h-12 rounded-xl"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="Nair"
                        data-testid="input-last-name"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="auth-email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
                    <Input
                      id="auth-email"
                      type="email"
                      required
                      className="h-12 rounded-xl !pl-10"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      autoComplete="email"
                      data-testid="input-email"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor="auth-password">Password</Label>
                    {mode === "signin" && (
                      <Link
                        href="/forgot-password"
                        className="text-xs font-medium text-primary hover:underline"
                        data-testid="link-forgot-password"
                      >
                        Forgot password?
                      </Link>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
                    <Input
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={6}
                      className="h-12 rounded-xl !pl-10 !pr-11"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      data-testid="input-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      data-testid="toggle-password"
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 rounded-xl gradient-btn text-white font-bold shadow-lg shadow-emerald-600/20"
                  disabled={isLoading}
                  data-testid="button-submit"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : mode === "signup" ? (
                    <Sparkles className="w-4 h-4 mr-2" />
                  ) : (
                    <Lock className="w-4 h-4 mr-2" />
                  )}
                  {mode === "signup" ? "Start free trial" : "Sign in"}
                </Button>
              </form>

              <p className="text-sm text-muted-foreground mt-5 text-center">
                {mode === "signup" ? (
                  <>Already have an account?{" "}
                    <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setMode("signin")} data-testid="switch-signin">
                      Sign in
                    </button>
                  </>
                ) : (
                  <>New to DealInSec?{" "}
                    <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setMode("signup")} data-testid="switch-signup">
                      Start your free trial
                    </button>
                  </>
                )}
              </p>

              {/* Trust strip — facts, not badges */}
              <div className="mt-6 pt-5 border-t border-border grid grid-cols-3 gap-2">
                {TRUST_STRIP.map(({ icon: Icon, title, sub }) => (
                  <div key={title} className="text-center px-1">
                    <Icon className="w-4 h-4 text-primary mx-auto mb-1.5" strokeWidth={2} aria-hidden="true" />
                    <p className="text-[11px] font-semibold leading-tight">{title}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{sub}</p>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground text-center mt-5">
              By continuing you agree to our{" "}
              <Link href="/terms" className="underline hover:text-foreground">Terms</Link> and{" "}
              <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
            </p>
          </div>
        </div>
      </div>

      {/* ══ Desktop brand panel ══ */}
      <div
        className="hidden lg:flex relative overflow-hidden flex-col justify-center px-14 xl:px-20 order-first lg:order-none"
        style={{
          background:
            "radial-gradient(120% 70% at 20% 0%, hsl(160 84% 26%) 0%, hsl(160 84% 18%) 45%, hsl(174 60% 12%) 100%)",
        }}
      >
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-white/5 -mr-24 -mt-24" aria-hidden="true" />
        <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full bg-emerald-400/10 -ml-16 -mb-16 blur-2xl" aria-hidden="true" />

        <div className="relative max-w-lg">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-300 mb-4">
            Deal · Sign · Secured
          </p>
          <h2 className="text-3xl xl:text-[40px] font-bold text-white leading-[1.12] tracking-tight">
            Get every deal in writing.<br />
            <span className="text-emerald-300">And get paid on time.</span>
          </h2>
          <p className="text-emerald-100/70 mt-4 text-sm leading-relaxed">
            One workflow for India's real estate consultants, interior designers,
            architects, agencies &amp; contractors — quotation, e-signed agreement,
            GST invoice and payment tracking.
          </p>

          <div className="flex items-center gap-2 mt-9">
            {PIPELINE.map(({ icon: Icon, label }, i) => (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && (
                  <span
                    className="w-6 border-t border-dashed border-emerald-400/50"
                    aria-hidden="true"
                  />
                )}
                <div className="flex flex-col items-center gap-2">
                  <span className="w-12 h-12 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-emerald-200" strokeWidth={2} />
                  </span>
                  <span className="text-[11px] font-semibold text-emerald-100/80 tracking-wide">{label}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-9 pt-8 border-t border-emerald-400/20">
            <ul className="space-y-3">
              {PROOF_POINTS.map((point) => (
                <li key={point} className="flex items-center gap-2.5 text-sm text-emerald-50/90">
                  <span className="w-[18px] h-[18px] rounded-full bg-emerald-400/20 flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3 text-emerald-300" strokeWidth={3} />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* Honest closing card — what the product does, not borrowed credibility */}
          <div className="mt-9 rounded-2xl border border-emerald-400/20 bg-white/5 px-5 py-4 flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-emerald-400/15 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4.5 h-4.5 w-[18px] h-[18px] text-emerald-300" strokeWidth={2} />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">Made for the Indian financial year</p>
              <p className="text-xs text-emerald-100/70 leading-relaxed mt-0.5">
                Invoices numbered consecutively per FY, GSTIN on your documents, amounts in ₹,
                and every agreement carrying its own execution record.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
