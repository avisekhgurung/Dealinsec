/**
 * Reset password — lands here from the email link
 * (/reset-password?email=…&token=…). On success the API signs the user in
 * (the email already proved mailbox control) and we go straight to the app.
 */
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, KeyRound, Eye, EyeOff } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DealinsecLogo } from "@/components/dealinsec-logo";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { email, token } = useMemo(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return { email: p.get("email") ?? "", token: p.get("token") ?? "" };
    } catch {
      return { email: "", token: "" };
    }
  }, []);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const linkBroken = !email || !token;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/auth/reset-password", { email, token, password });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Password updated", description: "You're signed in with your new password." });
      setLocation("/dashboard");
    } catch (error: any) {
      toast({
        title: "Could not reset password",
        description: error.message || "This link may have expired — request a new one.",
        variant: "destructive",
      });
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
        {linkBroken ? (
          <div className="text-center py-4">
            <h1 className="text-xl font-bold">This link isn't complete</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Open the reset link from your email again, or request a fresh one.
            </p>
            <Link href="/forgot-password">
              <Button variant="outline" className="mt-6 font-semibold">Request a new link</Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-4">
              <KeyRound className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h1 className="text-xl font-bold">Set a new password</h1>
            <p className="text-sm text-muted-foreground mt-1 mb-6 truncate">for {email}</p>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="rp-password">New password</Label>
                <div className="relative">
                <Input id="rp-password" type={showPassword ? "text" : "password"} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" data-testid="input-new-password" />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"} data-testid="toggle-password"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp-confirm">Confirm password</Label>
                <div className="relative">
                <Input id="rp-confirm" type={showPassword ? "text" : "password"} required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again" data-testid="input-confirm-password" />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"} data-testid="toggle-password"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full h-11 gradient-btn text-white font-bold" disabled={isLoading} data-testid="button-reset-password">
                {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Update password &amp; sign in
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
