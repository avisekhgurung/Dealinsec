/**
 * Forgot password — request a reset link.
 * Always shows the same success state whether or not the account exists
 * (the API is anti-enumeration by design).
 */
import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, MailCheck, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DealinsecLogo } from "@/components/dealinsec-logo";

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/auth/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (error: any) {
      toast({ title: "Something went wrong", description: error.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted flex flex-col items-center justify-center px-4 py-8">
      <Link href="/" className="mb-8" aria-label="Back to home">
        <DealinsecLogo size="md" />
      </Link>
      <div className="glass-card w-full max-w-md rounded-2xl p-6 sm:p-8 border-0 animate-fade-in" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.5)" }}>
        {sent ? (
          <div className="text-center py-4" data-testid="reset-sent">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
              <MailCheck className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h1 className="text-xl font-bold">Check your email</h1>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              If an account exists for <b className="text-foreground">{email.trim()}</b>, we've
              sent a password-reset link. It's valid for <b>30 minutes</b> — check spam if
              it doesn't arrive in a minute or two.
            </p>
            <Link href="/auth?mode=signin">
              <Button variant="outline" className="mt-6 font-semibold" data-testid="back-to-signin">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to sign in
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold">Reset your password</h1>
            <p className="text-sm text-muted-foreground mt-1 mb-6">
              Enter your account email and we'll send you a reset link.
            </p>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fp-email">Email</Label>
                <Input id="fp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" data-testid="input-email" />
              </div>
              <Button type="submit" className="w-full h-11 gradient-btn text-white font-bold" disabled={isLoading || !email.trim()} data-testid="button-send-reset">
                {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Send reset link
              </Button>
            </form>
            <p className="text-sm text-muted-foreground mt-5 text-center">
              Remembered it?{" "}
              <Link href="/auth?mode=signin" className="font-semibold text-primary hover:underline">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
