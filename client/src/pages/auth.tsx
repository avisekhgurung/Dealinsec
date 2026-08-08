/**
 * Dedicated authentication page — replaces the landing-page popup.
 *
 * Split-screen: form on the left, brand panel on the right (the emerald
 * gradient + the real 4-step workflow, matching the splash screen), so
 * signing in feels like part of the product, not an interruption.
 * Mode comes from ?mode=signin|signup and is toggleable in place.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2, Briefcase, FileText, FileCheck, Receipt, Check, ArrowLeft,
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
  "7-day Pro trial — everything unlocked",
  "No credit card required",
  "Built for India's deal-led businesses",
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
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* ── Form side ── */}
      <div className="flex flex-col px-5 py-6 sm:px-8 lg:px-12 xl:px-16">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex" aria-label="Back to home">
            <DealinsecLogo size="sm" />
          </Link>
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to site
          </Link>
        </div>

        <div className="flex-1 flex items-center justify-center py-10">
          <div className="w-full max-w-md">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="auth-heading">
              {mode === "signup" ? "Create your account" : "Welcome back"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 mb-6">
              {mode === "signup"
                ? "No credit card. Every Pro feature free for 7 days."
                : "Sign in to continue to your workspace."}
            </p>

            <Button
              type="button"
              variant="outline"
              className="w-full h-11 font-semibold"
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
                    <Input id="auth-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Meera" data-testid="input-first-name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="auth-last">Last name</Label>
                    <Input id="auth-last" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nair" data-testid="input-last-name" />
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="auth-email">Email</Label>
                <Input id="auth-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" data-testid="input-email" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="auth-password">Password</Label>
                  {mode === "signin" && (
                    <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline" data-testid="link-forgot-password">
                      Forgot password?
                    </Link>
                  )}
                </div>
                <Input id="auth-password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "signup" ? "At least 6 characters" : "Your password"} data-testid="input-password" />
              </div>
              <Button type="submit" className="w-full h-11 gradient-btn text-white font-bold" disabled={isLoading} data-testid="button-submit">
                {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
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
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground text-center">
          By continuing you agree to our{" "}
          <Link href="/terms" className="underline hover:text-foreground">Terms</Link> and{" "}
          <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
        </p>
      </div>

      {/* ── Brand panel ── */}
      <div
        className="hidden lg:flex relative overflow-hidden flex-col justify-center px-14 xl:px-20"
        style={{
          background:
            "radial-gradient(120% 70% at 20% 0%, hsl(160 84% 26%) 0%, hsl(160 84% 18%) 45%, hsl(174 60% 12%) 100%)",
        }}
        aria-hidden="true"
      >
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-white/5 -mr-24 -mt-24" />
        <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full bg-emerald-400/10 -ml-16 -mb-16 blur-2xl" />

        <div className="relative max-w-lg">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-300 mb-4">
            Deal · Sign · Secured
          </p>
          <h2 className="text-3xl xl:text-4xl font-bold text-white leading-tight tracking-tight">
            Get every deal in writing.<br />
            <span className="text-emerald-300">And get paid on time.</span>
          </h2>
          <p className="text-emerald-100/70 mt-4 text-sm leading-relaxed">
            One workflow for India's real estate consultants, interior designers,
            architects, agencies &amp; contractors — quotation, e-signed agreement,
            GST invoice and payment tracking.
          </p>

          <div className="flex items-center gap-2 mt-8">
            {PIPELINE.map(({ icon: Icon, label }, i) => (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && <span className="w-5 h-px bg-emerald-400/40" />}
                <div className="flex flex-col items-center gap-1.5">
                  <span className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-emerald-200" strokeWidth={2} />
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-100/80 tracking-wide">{label}</span>
                </div>
              </div>
            ))}
          </div>

          <ul className="mt-8 space-y-2.5">
            {PROOF_POINTS.map((point) => (
              <li key={point} className="flex items-center gap-2.5 text-sm text-emerald-50/90">
                <span className="w-4.5 h-4.5 w-[18px] h-[18px] rounded-full bg-emerald-400/20 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3 text-emerald-300" strokeWidth={3} />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
