import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Briefcase, FileText, CreditCard, CheckCircle, Loader2 } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";

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
    <div className="min-h-screen relative overflow-hidden">
      {/* Decorative background orbs */}
      <div className="orb orb-purple w-[500px] h-[500px] -top-48 -left-48" />
      <div className="orb orb-indigo w-[400px] h-[400px] top-1/3 -right-32" />
      <div className="orb orb-pink w-[350px] h-[350px] -bottom-32 left-1/4" />

      <div className="container relative z-10 mx-auto px-4 py-8">
        {/* Header */}
        <header className="text-center mb-16 pt-12 animate-fade-in">
          <h1
            className="text-5xl md:text-6xl font-bold mb-4 gradient-text tracking-tight"
            data-testid="text-app-title"
          >
            InfluDeal
          </h1>
          <p
            className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed"
            data-testid="text-app-description"
          >
            Professionally manage your brand deals, contracts, and billing - all in one place
          </p>
        </header>

        {/* Feature cards */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16 animate-fade-in"
          style={{ animationDelay: "0.1s" }}
        >
          <Card className="glass-card rounded-2xl border-0">
            <CardHeader className="pb-3">
              <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center mb-3">
                <Briefcase className="h-5 w-5 text-white" />
              </div>
              <CardTitle className="text-lg">Track Deals</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Manage all your brand partnerships with detailed deliverables tracking
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="glass-card rounded-2xl border-0">
            <CardHeader className="pb-3">
              <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center mb-3">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <CardTitle className="text-lg">Sign Contracts</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Create exclusive contracts with proof uploads and professional documentation
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="glass-card rounded-2xl border-0">
            <CardHeader className="pb-3">
              <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center mb-3">
                <CreditCard className="h-5 w-5 text-white" />
              </div>
              <CardTitle className="text-lg">Handle Billing</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Auto-generated invoices with transparent platform fees
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="glass-card rounded-2xl border-0">
            <CardHeader className="pb-3">
              <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center mb-3">
                <CheckCircle className="h-5 w-5 text-white" />
              </div>
              <CardTitle className="text-lg">Stay Organized</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Mobile-first experience designed for influencers on the go
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        {/* Auth card */}
        <div
          className="text-center animate-fade-in"
          style={{ animationDelay: "0.2s" }}
        >
          <Card className="glass-card rounded-2xl border-0 max-w-md mx-auto">
            <CardHeader>
              <CardTitle className="text-2xl font-semibold">Get Started</CardTitle>
              <CardDescription>
                Sign in or create an account to manage your influencer business
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="login" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-2">
                  <TabsTrigger value="login" data-testid="tab-login">Sign In</TabsTrigger>
                  <TabsTrigger value="signup" data-testid="tab-signup">Sign Up</TabsTrigger>
                </TabsList>

                {/* Login tab */}
                <TabsContent value="login">
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => { window.location.href = '/api/auth/google'; }}
                      className="glass-card rounded-xl border border-white/30 flex items-center gap-3 w-full py-3 px-4 cursor-pointer hover:shadow-md transition-all"
                    >
                      <SiGoogle className="h-5 w-5 text-[#4285F4]" />
                      <span className="font-medium">Continue with Google</span>
                    </button>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <div className="flex-1 border-t border-white/20" />
                      <span>or continue with email</span>
                      <div className="flex-1 border-t border-white/20" />
                    </div>
                  </div>
                  <form onSubmit={handleLogin} className="space-y-4 mt-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email">Email</Label>
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="you@example.com"
                        className="bg-white/50 dark:bg-white/5"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        required
                        data-testid="input-login-email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password">Password</Label>
                      <Input
                        id="login-password"
                        type="password"
                        placeholder="Enter your password"
                        className="bg-white/50 dark:bg-white/5"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        required
                        data-testid="input-login-password"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full gradient-btn text-white border-0"
                      disabled={isLoading}
                      data-testid="button-login"
                    >
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign In"}
                    </Button>
                  </form>
                </TabsContent>

                {/* Signup tab */}
                <TabsContent value="signup">
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => { window.location.href = '/api/auth/google'; }}
                      className="glass-card rounded-xl border border-white/30 flex items-center gap-3 w-full py-3 px-4 cursor-pointer hover:shadow-md transition-all"
                    >
                      <SiGoogle className="h-5 w-5 text-[#4285F4]" />
                      <span className="font-medium">Continue with Google</span>
                    </button>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <div className="flex-1 border-t border-white/20" />
                      <span>or continue with email</span>
                      <div className="flex-1 border-t border-white/20" />
                    </div>
                  </div>
                  <form onSubmit={handleSignup} className="space-y-4 mt-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="signup-firstname">First Name</Label>
                        <Input
                          id="signup-firstname"
                          type="text"
                          placeholder="John"
                          className="bg-white/50 dark:bg-white/5"
                          value={signupFirstName}
                          onChange={(e) => setSignupFirstName(e.target.value)}
                          data-testid="input-signup-firstname"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="signup-lastname">Last Name</Label>
                        <Input
                          id="signup-lastname"
                          type="text"
                          placeholder="Doe"
                          className="bg-white/50 dark:bg-white/5"
                          value={signupLastName}
                          onChange={(e) => setSignupLastName(e.target.value)}
                          data-testid="input-signup-lastname"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-email">Email</Label>
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="you@example.com"
                        className="bg-white/50 dark:bg-white/5"
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                        required
                        data-testid="input-signup-email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-password">Password</Label>
                      <Input
                        id="signup-password"
                        type="password"
                        placeholder="At least 6 characters"
                        className="bg-white/50 dark:bg-white/5"
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                        required
                        minLength={6}
                        data-testid="input-signup-password"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full gradient-btn text-white border-0"
                      disabled={isLoading}
                      data-testid="button-signup"
                    >
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Account"}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        <footer className="text-center mt-12 text-sm text-muted-foreground animate-fade-in" style={{ animationDelay: "0.3s" }}>
          <p>3 Free Contract Credits on Signup</p>
        </footer>
      </div>
    </div>
  );
}
