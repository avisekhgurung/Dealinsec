import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Briefcase, FileText, Receipt, Sparkles, Loader2, Shield, Check, type LucideIcon } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation, Link } from "wouter";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupFirstName, setSignupFirstName] = useState("");
  const [signupLastName, setSignupLastName] = useState("");
  const [referralCode, setReferralCode] = useState("");

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const ref = urlParams.get("ref");
    if (ref) setReferralCode(ref);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/auth/login", { email: loginEmail, password: loginPassword });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid email or password",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/auth/signup", {
        email: signupEmail,
        password: signupPassword,
        firstName: signupFirstName,
        lastName: signupLastName,
        referralCode: referralCode || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    } catch (error: any) {
      toast({
        title: "Signup Failed",
        description: error.message || "Could not create account",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 relative">
      {/* Subtle dotted grid background — professional, not flashy */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.35] dark:opacity-[0.15]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(5, 150, 105, 0.15) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Very soft single glow — top right only, understated */}
      <div
        className="absolute top-0 right-0 w-[600px] h-[600px] pointer-events-none opacity-40 dark:opacity-20"
        style={{
          background:
            "radial-gradient(circle at center, rgba(5, 150, 105, 0.18) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10">
        {/* Top nav bar */}
        <nav className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
            >
              <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-lg font-semibold text-neutral-900 dark:text-white tracking-tight">
              InfluDeal
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <Shield className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Trusted by creators across India</span>
          </div>
        </nav>

        {/* Hero */}
        <div className="max-w-6xl mx-auto px-6 pt-8 pb-16 lg:pt-16 lg:pb-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: copy */}
            <div className="space-y-6 animate-fade-in">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/40">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  Built for Indian creators
                </span>
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-neutral-900 dark:text-white leading-[1.05]">
                Run your brand deals like a{" "}
                <span
                  style={{
                    background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  business
                </span>
              </h1>

              <p className="text-base md:text-lg text-neutral-600 dark:text-neutral-400 leading-relaxed max-w-lg">
                Send quotations, generate signed agreements, and get paid on time.
                All from one dashboard — no spreadsheets, no lost threads.
              </p>

              {/* Value props */}
              <ul className="space-y-2.5 pt-2">
                {[
                  "Professional quotations & invoices in 60 seconds",
                  "Legally-worded agreements with digital signatures",
                  "Track advances, payments, and deliverables",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-neutral-700 dark:text-neutral-300">
                    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 mt-0.5 flex-shrink-0">
                      <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
                    </div>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              {/* Trust signal */}
              <div className="flex items-center gap-6 pt-4 border-t border-neutral-200 dark:border-neutral-800">
                <div>
                  <p className="text-2xl font-bold text-neutral-900 dark:text-white tracking-tight">3</p>
                  <p className="text-xs text-neutral-500">Free credits on signup</p>
                </div>
                <div className="h-8 w-px bg-neutral-200 dark:bg-neutral-800" />
                <div>
                  <p className="text-2xl font-bold text-neutral-900 dark:text-white tracking-tight">₹0</p>
                  <p className="text-xs text-neutral-500">Platform fee on deals</p>
                </div>
                <div className="h-8 w-px bg-neutral-200 dark:bg-neutral-800" />
                <div>
                  <p className="text-2xl font-bold text-neutral-900 dark:text-white tracking-tight">60s</p>
                  <p className="text-xs text-neutral-500">To first invoice</p>
                </div>
              </div>
            </div>

            {/* Right: auth card */}
            <div className="animate-fade-in lg:pl-8" style={{ animationDelay: "0.15s" }}>
              {referralCode && (
                <div className="mb-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-xl px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <p className="text-sm text-emerald-800 dark:text-emerald-300">
                    You've been invited by a friend. Sign up to get started.
                  </p>
                </div>
              )}

              <Card className="border border-neutral-200 dark:border-neutral-800 shadow-sm rounded-2xl bg-white dark:bg-neutral-900/50 backdrop-blur-sm">
                <CardContent className="p-6 md:p-7">
                  <div className="mb-5">
                    <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">
                      Get started for free
                    </h2>
                    <p className="text-sm text-neutral-500 mt-1">
                      No credit card required
                    </p>
                  </div>

                  <Tabs defaultValue="signup" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 mb-5 bg-neutral-100 dark:bg-neutral-800 p-1 h-9">
                      <TabsTrigger value="signup" data-testid="tab-signup" className="text-xs data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-900">Sign Up</TabsTrigger>
                      <TabsTrigger value="login" data-testid="tab-login" className="text-xs data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-900">Sign In</TabsTrigger>
                    </TabsList>

                    {/* Signup tab */}
                    <TabsContent value="signup" className="mt-0">
                      <button
                        type="button"
                        onClick={() => { window.location.href = referralCode ? `/api/auth/google?ref=${referralCode}` : '/api/auth/google'; }}
                        className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors text-sm font-medium text-neutral-800 dark:text-neutral-200"
                      >
                        <SiGoogle className="h-4 w-4 text-emerald-600" />
                        <span>Continue with Google</span>
                      </button>

                      <div className="flex items-center gap-3 text-[11px] text-neutral-500 my-4">
                        <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
                        <span className="uppercase tracking-wider">or</span>
                        <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
                      </div>

                      <form onSubmit={handleSignup} className="space-y-3.5">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="signup-firstname" className="text-xs font-medium text-neutral-700 dark:text-neutral-300">First name</Label>
                            <Input
                              id="signup-firstname"
                              type="text"
                              placeholder="John"
                              className="h-9 text-sm bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700"
                              value={signupFirstName}
                              onChange={(e) => setSignupFirstName(e.target.value)}
                              data-testid="input-signup-firstname"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="signup-lastname" className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Last name</Label>
                            <Input
                              id="signup-lastname"
                              type="text"
                              placeholder="Doe"
                              className="h-9 text-sm bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700"
                              value={signupLastName}
                              onChange={(e) => setSignupLastName(e.target.value)}
                              data-testid="input-signup-lastname"
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="signup-email" className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Work email</Label>
                          <Input
                            id="signup-email"
                            type="email"
                            placeholder="you@example.com"
                            className="h-9 text-sm bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700"
                            value={signupEmail}
                            onChange={(e) => setSignupEmail(e.target.value)}
                            required
                            data-testid="input-signup-email"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="signup-password" className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Password</Label>
                          <Input
                            id="signup-password"
                            type="password"
                            placeholder="At least 6 characters"
                            className="h-9 text-sm bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700"
                            value={signupPassword}
                            onChange={(e) => setSignupPassword(e.target.value)}
                            required
                            minLength={6}
                            data-testid="input-signup-password"
                          />
                        </div>
                        <Button
                          type="submit"
                          className="w-full h-10 text-sm font-semibold text-white border-0 mt-2"
                          style={{
                            background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)",
                          }}
                          disabled={isLoading}
                          data-testid="button-signup"
                        >
                          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create free account"}
                        </Button>
                        <p className="text-[11px] text-neutral-500 text-center leading-relaxed">
                          By signing up, you agree to our{" "}
                          <Link href="/terms" className="underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-300">Terms</Link>
                          {" "}&{" "}
                          <Link href="/privacy" className="underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-300">Privacy Policy</Link>
                        </p>
                      </form>
                    </TabsContent>

                    {/* Login tab */}
                    <TabsContent value="login" className="mt-0">
                      <button
                        type="button"
                        onClick={() => { window.location.href = referralCode ? `/api/auth/google?ref=${referralCode}` : '/api/auth/google'; }}
                        className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors text-sm font-medium text-neutral-800 dark:text-neutral-200"
                      >
                        <SiGoogle className="h-4 w-4 text-emerald-600" />
                        <span>Continue with Google</span>
                      </button>

                      <div className="flex items-center gap-3 text-[11px] text-neutral-500 my-4">
                        <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
                        <span className="uppercase tracking-wider">or</span>
                        <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
                      </div>

                      <form onSubmit={handleLogin} className="space-y-3.5">
                        <div className="space-y-1.5">
                          <Label htmlFor="login-email" className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Email</Label>
                          <Input
                            id="login-email"
                            type="email"
                            placeholder="you@example.com"
                            className="h-9 text-sm bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700"
                            value={loginEmail}
                            onChange={(e) => setLoginEmail(e.target.value)}
                            required
                            data-testid="input-login-email"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="login-password" className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Password</Label>
                          <Input
                            id="login-password"
                            type="password"
                            placeholder="Enter your password"
                            className="h-9 text-sm bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700"
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            required
                            data-testid="input-login-password"
                          />
                        </div>
                        <Button
                          type="submit"
                          className="w-full h-10 text-sm font-semibold text-white border-0 mt-2"
                          style={{
                            background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)",
                          }}
                          disabled={isLoading}
                          data-testid="button-login"
                        >
                          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
                        </Button>
                      </form>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Features strip — clean, icon-led, no gradient cards */}
        <div className="border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/30">
          <div className="max-w-6xl mx-auto px-6 py-12 lg:py-16">
            <div className="text-center mb-10">
              <p className="text-xs uppercase tracking-widest text-emerald-600 dark:text-emerald-400 font-semibold mb-2">
                How it works
              </p>
              <h2 className="text-2xl md:text-3xl font-bold text-neutral-900 dark:text-white tracking-tight">
                From handshake to payment
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-10">
              <FeatureItem
                step="01"
                icon={Briefcase}
                title="Create a deal"
                description="Log brand partnerships with deliverables, timelines, and pricing. Send a quotation in seconds."
              />
              <FeatureItem
                step="02"
                icon={FileText}
                title="Sign agreement"
                description="Generate a professional agreement PDF with signature blocks. Upload signed proof when returned."
              />
              <FeatureItem
                step="03"
                icon={Receipt}
                title="Get paid"
                description="Issue advance and final invoices. Track payments and mark them paid — all in one place."
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="border-t border-neutral-200 dark:border-neutral-800">
          <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded-md flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
              >
                <Sparkles className="w-3 h-3 text-white" strokeWidth={2.5} />
              </div>
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">InfluDeal</span>
              <span className="text-xs text-neutral-500 ml-2">© {new Date().getFullYear()}</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-neutral-500">
              <Link href="/terms" className="hover:text-neutral-900 dark:hover:text-neutral-300 transition-colors">Terms</Link>
              <Link href="/privacy" className="hover:text-neutral-900 dark:hover:text-neutral-300 transition-colors">Privacy</Link>
              <Link href="/cookies" className="hover:text-neutral-900 dark:hover:text-neutral-300 transition-colors">Cookies</Link>
              <Link href="/refund" className="hover:text-neutral-900 dark:hover:text-neutral-300 transition-colors">Refund</Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function FeatureItem({
  step,
  icon: Icon,
  title,
  description,
}: {
  step: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="relative">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-sm">
          <Icon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" strokeWidth={2.2} />
        </div>
        <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500 tracking-wider">{step}</span>
      </div>
      <h3 className="text-base font-semibold text-neutral-900 dark:text-white mb-1.5">{title}</h3>
      <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{description}</p>
    </div>
  );
}
