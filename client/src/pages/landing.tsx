import { useState, useEffect, useRef } from "react";
import { motion, useScroll, useTransform, useInView, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Briefcase,
  FileText,
  Receipt,
  Shield,
  Check,
  ChevronRight,
  ArrowRight,
  Sparkles,
  Zap,
  Lock,
  Activity,
  FileSignature,
  CreditCard,
  Loader2,
  Menu,
  X,
  LayoutDashboard,
  FileCheck,
  UserCircle,
  LogOut,
  Quote,
  Star,
  IndianRupee,
} from "lucide-react";
import { SiGoogle, SiInstagram, SiYoutube, SiX, SiFacebook, SiLinkedin } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { DealinsecLogo } from "@/components/dealinsec-logo";

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how" },
  { label: "Showcase", href: "#showcase" },
  { label: "Pricing", href: "/pricing" },
  { label: "FAQ", href: "#faq" },
];

const DASHBOARD_LINKS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Deals", href: "/deals", icon: Briefcase },
  { label: "Agreements", href: "/contracts", icon: FileCheck },
  { label: "Invoices", href: "/invoices", icon: Receipt },
  { label: "Profile", href: "/profile", icon: UserCircle },
];

const FEATURES = [
  {
    icon: Briefcase,
    title: "Deal Management",
    desc: "Log every collaboration with deliverables, timelines, and pricing in one clean dashboard.",
    tint: "emerald",
  },
  {
    icon: FileText,
    title: "Instant Quotations",
    desc: "Generate professional quotes in under 60 seconds. Your own terms, your own brand.",
    tint: "teal",
  },
  {
    icon: FileSignature,
    title: "Legal Agreements",
    desc: "Digitally-signed agreements with secure signature workflow and PDF downloads.",
    tint: "cyan",
  },
  {
    icon: Receipt,
    title: "Smart Invoices",
    desc: "Advance & final invoices with your banking details baked in. Track every rupee.",
    tint: "indigo",
  },
  {
    icon: Activity,
    title: "Deal Insights",
    desc: "Monitor pipeline value, payment status, and deliverables at a glance.",
    tint: "amber",
  },
  {
    icon: Lock,
    title: "Bank-Grade Security",
    desc: "Encrypted storage, secure payments, and session-level data protection.",
    tint: "rose",
  },
];

const WORKFLOW_STEPS = [
  {
    step: "01",
    icon: Briefcase,
    title: "Create Deal",
    desc: "Set up the collaboration — brand, deliverables, timeline, payment terms.",
  },
  {
    step: "02",
    icon: FileText,
    title: "Send Quotation",
    desc: "Professional quote with selectable T&Cs. Shareable in a click.",
  },
  {
    step: "03",
    icon: FileSignature,
    title: "Sign Agreement",
    desc: "Secure digital signatures. Both sides get legally-worded, downloadable PDFs.",
  },
  {
    step: "04",
    icon: CreditCard,
    title: "Get Paid",
    desc: "Advance and final invoices. Track payments and close deals on time.",
  },
];

const STATS = [
  { value: "60s", label: "To first invoice", sub: "From signup to sent" },
  { value: "10K+", label: "Active creators", sub: "Across India" },
  { value: "₹100Cr+", label: "Deals processed", sub: "And counting" },
  { value: "99.9%", label: "Uptime", sub: "Enterprise-grade" },
];

const TESTIMONIALS = [
  {
    quote:
      "Finally stopped chasing brands for payment. The invoice tracker alone saved me hours every week. This is how creator business should work.",
    name: "Aanya Kapoor",
    role: "Lifestyle Creator · 340K followers",
    rating: 5,
  },
  {
    quote:
      "The agreement flow is a game changer. Brands take me seriously when I send a proper signed contract. My rates went up 2x.",
    name: "Rohan Mehta",
    role: "Tech Creator · YouTube 1.2M",
    rating: 5,
  },
  {
    quote:
      "Clean, fast, and actually built for Indian creators. Banking details, GST, PAN — all handled. No more spreadsheets.",
    name: "Priya Iyer",
    role: "Fashion Influencer · Instagram 680K",
    rating: 5,
  },
];

const FAQS = [
  {
    q: "Is Dealinsec free to use?",
    a: "Yes. Every new account gets 3 free credits on signup and there's no platform fee on the value of your deals. Upgrade plans are available for higher volume.",
  },
  {
    q: "Do agreements generated here hold up legally?",
    a: "Yes. Agreements are generated with legally-worded clauses and captured via digital signatures. Both parties get a PDF copy for their records.",
  },
  {
    q: "Can I add my own terms and conditions?",
    a: "Absolutely. You can select our standard T&Cs or add your own custom clauses to any deal or quotation.",
  },
  {
    q: "How do I get paid?",
    a: "Your banking details (account number, IFSC, PAN) live in your profile and are auto-populated into every invoice you send. Brands pay you directly.",
  },
  {
    q: "Is my data secure?",
    a: "All data is encrypted in transit and at rest. Sessions are secured, and we never share your information with third parties.",
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

// ────────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"signup" | "login">("signup");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const openAuth = (tab: "signup" | "login") => {
    setAuthTab(tab);
    setAuthModalOpen(true);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/auth/login", { email: loginEmail, password: loginPassword });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setAuthModalOpen(false);
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
      setAuthModalOpen(false);
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
    <div className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 relative overflow-x-hidden antialiased">
      {/* Ambient decorative backdrop */}
      <AmbientBackdrop />

      <Header
        isAuthenticated={isAuthenticated}
        user={user}
        scrolled={scrolled}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        onAuthClick={openAuth}
      />

      <main className="relative z-[1]">
        <Hero
          referralCode={referralCode}
          isAuthenticated={isAuthenticated}
          onPrimaryClick={() => (isAuthenticated ? setLocation("/") : openAuth("signup"))}
        />
        <TrustStrip />
        <FeatureGrid />
        <WorkflowSection />
        <ProductShowcase />
        <StatsSection />
        <Testimonials />
        <PricingPreview onCTA={() => (isAuthenticated ? setLocation("/pricing") : openAuth("signup"))} />
        <FAQSection />
        <FinalCTA
          isAuthenticated={isAuthenticated}
          onCTA={() => (isAuthenticated ? setLocation("/") : openAuth("signup"))}
        />
      </main>

      <Footer />

      {/* Auth Modal */}
      <Dialog open={authModalOpen} onOpenChange={setAuthModalOpen}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
          <DialogTitle className="sr-only">Sign in or sign up</DialogTitle>
          <div className="p-6 sm:p-7">
            <div className="flex items-center gap-2.5 mb-5">
              <DealinsecLogo size="sm" withText />
            </div>
            <div className="mb-5">
              <h2 className="text-xl font-semibold">
                {authTab === "signup" ? "Create your account" : "Welcome back"}
              </h2>
              <p className="text-sm text-neutral-500 mt-1">
                {authTab === "signup" ? "No credit card. 3 free credits on signup." : "Sign in to continue"}
              </p>
            </div>

            {referralCode && (
              <div className="mb-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                  You've been invited by a friend.
                </p>
              </div>
            )}

            <Tabs value={authTab} onValueChange={(v) => setAuthTab(v as "signup" | "login")} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-5 bg-neutral-100 dark:bg-neutral-800 p-1 h-9">
                <TabsTrigger value="signup" data-testid="tab-signup" className="text-xs data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-900">
                  Sign Up
                </TabsTrigger>
                <TabsTrigger value="login" data-testid="tab-login" className="text-xs data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-900">
                  Sign In
                </TabsTrigger>
              </TabsList>

              <TabsContent value="signup" className="mt-0">
                <GoogleButton referralCode={referralCode} />
                <OrDivider />
                <form onSubmit={handleSignup} className="space-y-3.5">
                  <div className="grid grid-cols-2 gap-3">
                    <FieldGroup id="signup-firstname" label="First name">
                      <Input
                        id="signup-firstname"
                        type="text"
                        placeholder="John"
                        className="h-9 text-sm"
                        value={signupFirstName}
                        onChange={(e) => setSignupFirstName(e.target.value)}
                        data-testid="input-signup-firstname"
                      />
                    </FieldGroup>
                    <FieldGroup id="signup-lastname" label="Last name">
                      <Input
                        id="signup-lastname"
                        type="text"
                        placeholder="Doe"
                        className="h-9 text-sm"
                        value={signupLastName}
                        onChange={(e) => setSignupLastName(e.target.value)}
                        data-testid="input-signup-lastname"
                      />
                    </FieldGroup>
                  </div>
                  <FieldGroup id="signup-email" label="Work email">
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="you@example.com"
                      className="h-9 text-sm"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      required
                      data-testid="input-signup-email"
                    />
                  </FieldGroup>
                  <FieldGroup id="signup-password" label="Password">
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="At least 6 characters"
                      className="h-9 text-sm"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      required
                      minLength={6}
                      data-testid="input-signup-password"
                    />
                  </FieldGroup>
                  <Button
                    type="submit"
                    className="w-full h-10 text-sm font-semibold text-white border-0 mt-2 shadow-md shadow-emerald-500/20"
                    style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
                    disabled={isLoading}
                    data-testid="button-signup"
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create free account"}
                  </Button>
                  <p className="text-[11px] text-neutral-500 text-center leading-relaxed">
                    By signing up, you agree to our{" "}
                    <Link href="/terms" className="underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-300">
                      Terms
                    </Link>
                    {" "}&{" "}
                    <Link href="/privacy" className="underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-300">
                      Privacy Policy
                    </Link>
                  </p>
                </form>
              </TabsContent>

              <TabsContent value="login" className="mt-0">
                <GoogleButton referralCode={referralCode} />
                <OrDivider />
                <form onSubmit={handleLogin} className="space-y-3.5">
                  <FieldGroup id="login-email" label="Email">
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="you@example.com"
                      className="h-9 text-sm"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      required
                      data-testid="input-login-email"
                    />
                  </FieldGroup>
                  <FieldGroup id="login-password" label="Password">
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="Enter your password"
                      className="h-9 text-sm"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                      data-testid="input-login-password"
                    />
                  </FieldGroup>
                  <Button
                    type="submit"
                    className="w-full h-10 text-sm font-semibold text-white border-0 mt-2 shadow-md shadow-emerald-500/20"
                    style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
                    disabled={isLoading}
                    data-testid="button-login"
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

function AmbientBackdrop() {
  return (
    <>
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.35] dark:opacity-[0.12]"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(5, 150, 105, 0.12) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
        aria-hidden
      />
      <div
        className="fixed -top-32 -right-32 w-[720px] h-[720px] pointer-events-none opacity-50 dark:opacity-25 blur-3xl"
        style={{
          background: "radial-gradient(circle at center, rgba(16, 185, 129, 0.28) 0%, transparent 70%)",
        }}
        aria-hidden
      />
      <div
        className="fixed -bottom-40 -left-32 w-[680px] h-[680px] pointer-events-none opacity-40 dark:opacity-20 blur-3xl"
        style={{
          background: "radial-gradient(circle at center, rgba(13, 148, 136, 0.22) 0%, transparent 70%)",
        }}
        aria-hidden
      />
    </>
  );
}

function Header({
  isAuthenticated,
  user,
  scrolled,
  mobileMenuOpen,
  setMobileMenuOpen,
  onAuthClick,
}: {
  isAuthenticated: boolean;
  user: any;
  scrolled: boolean;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (v: boolean) => void;
  onAuthClick: (tab: "signup" | "login") => void;
}) {
  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      window.location.href = "/";
    } catch {}
  };

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-white/80 dark:bg-neutral-950/80 backdrop-blur-xl border-b border-neutral-200/70 dark:border-neutral-800/70"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <DealinsecLogo size="md" withText asLink />

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {(isAuthenticated ? DASHBOARD_LINKS : NAV_LINKS).map((link) => (
              <NavItem key={link.label} href={link.href} label={link.label} />
            ))}
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <>
                <Link href="/">
                  <Button
                    className="hidden sm:inline-flex h-9 px-4 text-sm font-semibold text-white border-0 shadow-sm shadow-emerald-500/20"
                    style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
                    data-testid="button-go-dashboard"
                  >
                    <LayoutDashboard className="w-4 h-4 mr-1.5" />
                    Dashboard
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleLogout}
                  className="h-9 w-9 text-neutral-500 hover:text-rose-600"
                  title="Log out"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={() => onAuthClick("login")}
                  className="hidden sm:inline-flex h-9 px-4 text-sm font-medium"
                  data-testid="button-nav-signin"
                >
                  Sign in
                </Button>
                <Button
                  onClick={() => onAuthClick("signup")}
                  className="h-9 px-4 text-sm font-semibold text-white border-0 shadow-sm shadow-emerald-500/20"
                  style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
                  data-testid="button-nav-signup"
                >
                  Get started
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </>
            )}

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 -mr-1 rounded-md text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="lg:hidden overflow-hidden border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950"
          >
            <div className="px-4 py-4 space-y-1">
              {(isAuthenticated ? DASHBOARD_LINKS : NAV_LINKS).map((link: any) => {
                const Icon = link.icon;
                return (
                  <a
                    key={link.label}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    {Icon && <Icon className="w-4 h-4 text-emerald-600" />}
                    {link.label}
                  </a>
                );
              })}
              {!isAuthenticated && (
                <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800 mt-2 flex flex-col gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onAuthClick("login");
                    }}
                    className="w-full h-10"
                  >
                    Sign in
                  </Button>
                  <Button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onAuthClick("signup");
                    }}
                    className="w-full h-10 text-white border-0"
                    style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
                  >
                    Get started
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function NavItem({ href, label }: { href: string; label: string }) {
  const isHash = href.startsWith("#");
  if (isHash) {
    return (
      <a
        href={href}
        className="px-3 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors rounded-md hover:bg-neutral-100/70 dark:hover:bg-neutral-800/50"
      >
        {label}
      </a>
    );
  }
  return (
    <Link href={href} className="px-3 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors rounded-md hover:bg-neutral-100/70 dark:hover:bg-neutral-800/50">
      {label}
    </Link>
  );
}

function Hero({
  referralCode,
  isAuthenticated,
  onPrimaryClick,
}: {
  referralCode: string;
  isAuthenticated: boolean;
  onPrimaryClick: () => void;
}) {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const floatY = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const floatOpacity = useTransform(scrollYProgress, [0, 1], [1, 0.3]);

  return (
    <section ref={heroRef} className="relative pt-12 sm:pt-20 lg:pt-28 pb-16 lg:pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {referralCode && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 mx-auto max-w-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-full px-4 py-2 flex items-center gap-2.5"
          >
            <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
            <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
              You've been invited by a friend. Sign up to claim.
            </p>
          </motion.div>
        )}

        <div className="text-center max-w-4xl mx-auto">
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="visible"
            className="space-y-6"
          >
            <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/70 dark:bg-neutral-900/70 backdrop-blur-sm border border-emerald-200/70 dark:border-emerald-800/40 shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                Built for Collaborations · Made in India
              </span>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              className="text-[2.5rem] sm:text-5xl lg:text-[4.5rem] font-bold tracking-tight leading-[1.02]"
            >
              Turning Collaborations
              <br />
              into{" "}
              <span
                className="relative inline-block"
                style={{
                  background: "linear-gradient(135deg, #059669 0%, #14B8A6 50%, #0D9488 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Professional Deals
                <motion.span
                  className="absolute -bottom-1 left-0 right-0 h-[6px] rounded-full opacity-40"
                  style={{ background: "linear-gradient(90deg, transparent, #10B981, transparent)" }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
                />
              </span>
            </motion.h1>

            <motion.p variants={fadeUp} className="text-base sm:text-lg lg:text-xl text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto leading-relaxed">
              Quotations, agreements, invoices, deals and payments —{" "}
              <span className="font-semibold text-neutral-900 dark:text-white">all in less than a minute.</span>{" "}
              One dashboard. Simple, professional, and built to get you paid on time.
            </motion.p>

            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Button
                onClick={onPrimaryClick}
                className="h-12 px-6 text-sm font-semibold text-white border-0 shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all w-full sm:w-auto"
                style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
                data-testid="button-hero-cta"
              >
                {isAuthenticated ? "Go to Dashboard" : "Start for free"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <a
                href="#how"
                className="h-12 px-6 inline-flex items-center justify-center text-sm font-semibold rounded-md border border-neutral-300 dark:border-neutral-700 bg-white/60 dark:bg-neutral-900/60 backdrop-blur-sm hover:bg-white dark:hover:bg-neutral-900 w-full sm:w-auto transition-colors"
              >
                See how it works
                <ChevronRight className="w-4 h-4 ml-1" />
              </a>
            </motion.div>

            <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 pt-3 text-xs text-neutral-500">
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-500" /> 3 free credits
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-500" /> ₹0 platform fee
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-500" /> No credit card required
              </span>
            </motion.div>
          </motion.div>

          {/* Floating product mockup */}
          <motion.div
            style={{ y: floatY, opacity: floatOpacity }}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="mt-14 lg:mt-20 relative"
          >
            <ProductPreview />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function ProductPreview() {
  return (
    <div className="relative max-w-5xl mx-auto">
      {/* Glow behind mockup */}
      <div
        className="absolute inset-x-0 -top-12 h-64 blur-3xl opacity-60"
        style={{ background: "radial-gradient(60% 80% at 50% 50%, rgba(16,185,129,0.35), transparent)" }}
      />

      {/* Browser chrome */}
      <div className="relative rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-2xl shadow-emerald-900/10 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60">
          <span className="w-3 h-3 rounded-full bg-red-400/80" />
          <span className="w-3 h-3 rounded-full bg-amber-400/80" />
          <span className="w-3 h-3 rounded-full bg-emerald-400/80" />
          <div className="ml-3 flex-1 max-w-xs mx-auto h-6 rounded-md bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center gap-1.5 text-[10px] text-neutral-500">
            <Lock className="w-2.5 h-2.5" /> dealinsec.com/dashboard
          </div>
        </div>

        {/* Dashboard content */}
        <div className="p-5 sm:p-8 bg-gradient-to-br from-white to-emerald-50/30 dark:from-neutral-900 dark:to-emerald-950/10">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-xs text-neutral-500">Welcome back,</p>
              <h3 className="text-lg sm:text-xl font-bold">Aanya Kapoor</h3>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
              <Sparkles className="w-3 h-3" />
              Pro
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Deals", value: "12", change: "+3", tint: "emerald" },
              { label: "Agreements", value: "8", change: "+2", tint: "teal" },
              { label: "Pipeline", value: "₹4.2L", change: "+18%", tint: "cyan" },
              { label: "Paid this month", value: "₹2.8L", change: "+42%", tint: "indigo" },
            ].map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 + i * 0.08 }}
                className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/80 p-3.5"
              >
                <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">{s.label}</p>
                <div className="flex items-end justify-between mt-1.5">
                  <p className="text-lg sm:text-xl font-bold">{s.value}</p>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                    {s.change}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Chart area + recent deals */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/80 p-4 min-h-[180px] overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold">Revenue trend</p>
                <span className="text-[10px] text-neutral-500">Last 30 days</span>
              </div>
              <MiniChart />
            </div>
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/80 p-4">
              <p className="text-xs font-semibold mb-3">Recent deals</p>
              <div className="space-y-2.5">
                {[
                  { name: "Nykaa · Summer Reel", status: "Paid", amount: "₹45K" },
                  { name: "boAt · YouTube Integ", status: "Signed", amount: "₹1.2L" },
                  { name: "Mamaearth · Story", status: "Quote", amount: "₹28K" },
                ].map((d) => (
                  <div key={d.name} className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium truncate">{d.name}</p>
                      <p className="text-[9px] text-neutral-500">{d.status}</p>
                    </div>
                    <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">{d.amount}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating badges */}
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="hidden md:flex absolute -left-8 top-20 items-center gap-2 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl shadow-emerald-900/10 px-3.5 py-2.5"
      >
        <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
          <FileSignature className="w-4 h-4 text-emerald-600" />
        </div>
        <div>
          <p className="text-[10px] text-neutral-500">Agreement signed</p>
          <p className="text-xs font-semibold">Mamaearth Pvt Ltd</p>
        </div>
      </motion.div>

      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1.5 }}
        className="hidden md:flex absolute -right-6 bottom-16 items-center gap-2 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl shadow-emerald-900/10 px-3.5 py-2.5"
      >
        <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
          <IndianRupee className="w-4 h-4 text-emerald-600" />
        </div>
        <div>
          <p className="text-[10px] text-neutral-500">Payment received</p>
          <p className="text-xs font-semibold">₹45,000</p>
        </div>
      </motion.div>
    </div>
  );
}

function MiniChart() {
  const points = [30, 40, 38, 55, 50, 68, 62, 78, 72, 88, 82, 96];
  const max = Math.max(...points);
  const w = 100;
  const h = 100;
  const stepX = w / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = h - (p / max) * h * 0.85;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  const areaPath = `${path} L ${w} ${h} L 0 ${h} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-32">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10B981" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        d={areaPath}
        fill="url(#chartFill)"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1 }}
      />
      <motion.path
        d={path}
        stroke="#10B981"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.6, ease: "easeOut" }}
      />
    </svg>
  );
}

function TrustStrip() {
  return (
    <section className="py-10 border-y border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center text-xs font-semibold uppercase tracking-widest text-neutral-500 mb-6"
        >
          Trusted by creators on
        </motion.p>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-5 opacity-70">
          {[
            { Icon: SiInstagram, name: "Instagram" },
            { Icon: SiYoutube, name: "YouTube" },
            { Icon: SiX, name: "X" },
            { Icon: SiFacebook, name: "Facebook" },
            { Icon: SiLinkedin, name: "LinkedIn" },
          ].map(({ Icon, name }, i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 0.8, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="flex items-center gap-2 text-neutral-600 dark:text-neutral-400"
            >
              <Icon className="w-5 h-5" />
              <span className="text-sm font-semibold">{name}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureGrid() {
  return (
    <section id="features" className="py-20 sm:py-28 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Everything you need"
          title={
            <>
              One platform for the{" "}
              <span style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                entire deal lifecycle
              </span>
            </>
          }
          subtitle="From the first handshake to final payment — manage it all from a single, powerful dashboard."
        />

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5 mt-14"
        >
          {FEATURES.map((f) => (
            <motion.div
              key={f.title}
              variants={fadeUp}
              whileHover={{ y: -4 }}
              className="group relative rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-6 hover:border-emerald-300 dark:hover:border-emerald-700/70 hover:shadow-xl hover:shadow-emerald-500/10 transition-all duration-300"
            >
              <div
                className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity"
                style={{ background: "radial-gradient(400px at var(--x, 50%) var(--y, 50%), rgba(16,185,129,0.06), transparent 60%)" }}
              />
              <div className="relative">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 bg-emerald-50 dark:bg-emerald-950/40 group-hover:scale-110 transition-transform">
                  <f.icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 className="text-base font-semibold mb-1.5">{f.title}</h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{f.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section id="how" className="py-20 sm:py-28 border-t border-neutral-200 dark:border-neutral-800 bg-gradient-to-b from-neutral-50/50 to-white dark:from-neutral-900/30 dark:to-neutral-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="How it works"
          title="From handshake to payment in 4 steps"
          subtitle="Every collaboration moves cleanly through the Dealinsec pipeline — no follow-ups, no lost threads."
        />

        <div className="mt-16 relative">
          {/* Desktop connector line */}
          <div className="hidden lg:block absolute top-[58px] left-[10%] right-[10%] h-0.5 bg-gradient-to-r from-transparent via-emerald-300/80 to-transparent dark:via-emerald-800/60" />

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8 relative"
          >
            {WORKFLOW_STEPS.map((s) => (
              <motion.div key={s.step} variants={fadeUp} className="relative">
                <div className="relative mx-auto w-[72px] h-[72px] rounded-2xl flex items-center justify-center mb-5 bg-white dark:bg-neutral-900 border border-emerald-200 dark:border-emerald-800/50 shadow-lg shadow-emerald-900/10">
                  <div
                    className="absolute inset-1 rounded-xl opacity-80"
                    style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.1), rgba(13,148,136,0.05))" }}
                  />
                  <s.icon className="relative w-7 h-7 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
                  <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center shadow-md">
                    {s.step}
                  </div>
                </div>
                <div className="text-center">
                  <h3 className="text-base font-semibold mb-1.5">{s.title}</h3>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed max-w-[22ch] mx-auto">{s.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function ProductShowcase() {
  const items = [
    {
      eyebrow: "Quotations",
      title: "Professional quotes in 60 seconds",
      desc: "Send out quotations with standard or custom terms. Brands see a polished, branded PDF they can approve or pay instantly.",
      bullets: [
        "Selectable standard T&Cs (30-day validity, 50% advance, etc.)",
        "Custom terms — add your own clauses",
        "Shareable link or branded PDF",
      ],
      mockup: <QuoteMockup />,
    },
    {
      eyebrow: "Agreements",
      title: "Legal agreements, digitally signed",
      desc: "Generate legally-worded agreements both parties can sign digitally. Downloadable PDFs for your records — no printing, no scanning.",
      bullets: [
        "Legally-worded standard templates",
        "Secure digital signature workflow",
        "Downloadable PDFs for both sides",
      ],
      mockup: <AgreementMockup />,
    },
    {
      eyebrow: "Invoices",
      title: "Get paid, track every rupee",
      desc: "Banking details, PAN, and IFSC are auto-filled into every invoice. Track advance and final payments without chasing emails.",
      bullets: [
        "Your banking details saved once, used everywhere",
        "Advance + final invoice split",
        "Real-time payment status tracking",
      ],
      mockup: <InvoiceMockup />,
    },
  ];

  return (
    <section id="showcase" className="py-20 sm:py-28">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Product showcase"
          title="Built like the tools you already love"
          subtitle="Opinionated, fast, and designed for how creators actually work."
        />

        <div className="mt-16 space-y-20 lg:space-y-28">
          {items.map((item, i) => (
            <ShowcaseRow key={item.title} {...item} reverse={i % 2 === 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ShowcaseRow({
  eyebrow,
  title,
  desc,
  bullets,
  mockup,
  reverse,
}: {
  eyebrow: string;
  title: string;
  desc: string;
  bullets: string[];
  mockup: React.ReactNode;
  reverse?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <div ref={ref} className={`grid lg:grid-cols-2 gap-10 lg:gap-16 items-center ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
      <motion.div
        initial={{ opacity: 0, x: reverse ? 40 : -40 }}
        animate={inView ? { opacity: 1, x: 0 } : {}}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="text-xs uppercase tracking-widest font-semibold text-emerald-600 dark:text-emerald-400 mb-3">{eyebrow}</p>
        <h3 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight mb-4">{title}</h3>
        <p className="text-base text-neutral-600 dark:text-neutral-400 leading-relaxed mb-6">{desc}</p>
        <ul className="space-y-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-sm text-neutral-700 dark:text-neutral-300">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 mt-0.5 flex-shrink-0">
                <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
              </div>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: reverse ? -40 : 40 }}
        animate={inView ? { opacity: 1, x: 0 } : {}}
        transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="relative"
      >
        <div
          className="absolute -inset-6 rounded-3xl blur-2xl opacity-40"
          style={{ background: "radial-gradient(60% 60% at 50% 50%, rgba(16,185,129,0.25), transparent)" }}
        />
        <div className="relative">{mockup}</div>
      </motion.div>
    </div>
  );
}

function QuoteMockup() {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl shadow-emerald-900/10 p-6">
      <div className="flex items-center justify-between mb-5 pb-4 border-b border-neutral-200 dark:border-neutral-800">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-neutral-500">Quotation</p>
          <p className="text-sm font-bold mt-1">QUO-2026-0042</p>
        </div>
        <DealinsecLogo size="sm" withText={false} />
      </div>
      <div className="space-y-3">
        <div className="flex justify-between text-xs">
          <span className="text-neutral-500">To</span>
          <span className="font-semibold">Nykaa Pvt Ltd</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-neutral-500">Deliverable</span>
          <span className="font-semibold">1 Instagram Reel · 1 Story</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-neutral-500">Valid till</span>
          <span className="font-semibold">22 May 2026</span>
        </div>
      </div>
      <div className="mt-5 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
        <p className="text-[10px] uppercase tracking-widest text-emerald-700 dark:text-emerald-300 font-semibold mb-2">Standard Terms ·  4 selected</p>
        <ul className="text-[11px] space-y-1 text-neutral-700 dark:text-neutral-300">
          <li>✓ Valid for 30 days</li>
          <li>✓ 50% advance to confirm</li>
          <li>✓ 50% balance in 7 days post-delivery</li>
          <li>✓ Up to 2 revisions included</li>
        </ul>
      </div>
      <div className="flex items-end justify-between mt-5 pt-4 border-t border-neutral-200 dark:border-neutral-800">
        <div>
          <p className="text-[10px] uppercase text-neutral-500">Total</p>
          <p className="text-xl font-bold text-emerald-600">₹45,000</p>
        </div>
        <div className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-semibold">Send quote</div>
      </div>
    </div>
  );
}

function AgreementMockup() {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl shadow-emerald-900/10 p-6">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
          <FileSignature className="w-4 h-4 text-emerald-600" />
        </div>
        <div>
          <p className="text-sm font-bold">Collaboration Agreement</p>
          <p className="text-[10px] text-neutral-500">Between Aanya Kapoor and Nykaa Pvt Ltd</p>
        </div>
      </div>

      <div className="space-y-2 text-[11px] text-neutral-600 dark:text-neutral-400 leading-relaxed mb-5">
        <p>This agreement confirms the collaboration terms between the parties...</p>
        <p className="opacity-60">Section 1 — Scope of work · Section 2 — Compensation...</p>
        <p className="opacity-40">Section 3 — Exclusivity...</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
          <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1">Creator</p>
          <p className="text-xs font-bold italic text-emerald-700 dark:text-emerald-300" style={{ fontFamily: "Georgia, serif" }}>Aanya K.</p>
          <div className="flex items-center gap-1 mt-1.5">
            <Check className="w-3 h-3 text-emerald-600" />
            <p className="text-[9px] text-emerald-700 dark:text-emerald-400 font-semibold">Signed · 22 Apr</p>
          </div>
        </div>
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
          <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1">Brand</p>
          <div className="h-4 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
          <div className="flex items-center gap-1 mt-1.5">
            <div className="w-3 h-3 rounded-full border-2 border-amber-500 animate-pulse" />
            <p className="text-[9px] text-amber-700 font-semibold">Awaiting signature</p>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between text-[10px] text-neutral-500">
        <span className="flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> 256-bit encrypted</span>
        <span>Download PDF →</span>
      </div>
    </div>
  );
}

function InvoiceMockup() {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl shadow-emerald-900/10 p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-neutral-500">Invoice</p>
          <p className="text-sm font-bold mt-1">INV-2026-0078</p>
        </div>
        <div className="px-2 py-1 rounded-md bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold flex items-center gap-1">
          <Check className="w-3 h-3" /> PAID
        </div>
      </div>

      <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 p-4 mb-5">
        <p className="text-[10px] uppercase tracking-widest text-neutral-600 dark:text-neutral-400 font-semibold mb-1">Amount received</p>
        <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">₹45,000</p>
        <p className="text-[10px] text-neutral-500 mt-1">Final payment · 22 Apr 2026</p>
      </div>

      <div className="space-y-2 text-[11px]">
        <p className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold mb-1">Paid to</p>
        <div className="flex justify-between"><span className="text-neutral-500">Account holder</span><span className="font-semibold">Aanya Kapoor</span></div>
        <div className="flex justify-between"><span className="text-neutral-500">Account number</span><span className="font-semibold font-mono">XXXX 4521</span></div>
        <div className="flex justify-between"><span className="text-neutral-500">IFSC</span><span className="font-semibold font-mono">HDFC0001234</span></div>
        <div className="flex justify-between"><span className="text-neutral-500">PAN</span><span className="font-semibold font-mono">ABCDE1234F</span></div>
      </div>
    </div>
  );
}

function StatsSection() {
  return (
    <section className="py-20 sm:py-24 border-y border-neutral-200 dark:border-neutral-800 bg-gradient-to-r from-emerald-50/50 via-white to-teal-50/50 dark:from-emerald-950/20 dark:via-neutral-950 dark:to-teal-950/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-10"
        >
          {STATS.map((s) => (
            <motion.div key={s.label} variants={fadeUp} className="text-center">
              <p
                className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight"
                style={{
                  background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {s.value}
              </p>
              <p className="text-sm font-semibold mt-2">{s.label}</p>
              <p className="text-xs text-neutral-500 mt-0.5">{s.sub}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function Testimonials() {
  return (
    <section className="py-20 sm:py-28">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Loved by creators"
          title="Join thousands closing better deals"
          subtitle="Real stories from real creators who ship brand work through Dealinsec."
        />

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-14"
        >
          {TESTIMONIALS.map((t) => (
            <motion.div
              key={t.name}
              variants={fadeUp}
              className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-6 relative"
            >
              <Quote className="absolute top-5 right-5 w-8 h-8 text-emerald-200 dark:text-emerald-900/50" />
              <div className="flex gap-0.5 mb-3">
                {Array.from({ length: t.rating }).map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed mb-5">"{t.quote}"</p>
              <div className="flex items-center gap-3 pt-4 border-t border-neutral-200 dark:border-neutral-800">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold"
                  style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
                >
                  {t.name[0]}
                </div>
                <div>
                  <p className="text-sm font-semibold">{t.name}</p>
                  <p className="text-xs text-neutral-500">{t.role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function PricingPreview({ onCTA }: { onCTA: () => void }) {
  const plans = [
    {
      name: "Starter",
      price: "Free",
      desc: "For creators just starting out",
      features: ["3 free credits", "Quotations & Invoices", "Basic agreements", "Email support"],
      cta: "Start free",
      popular: false,
    },
    {
      name: "Pro",
      price: "₹499",
      per: "/month",
      desc: "For creators shipping regular deals",
      features: ["Unlimited deals & invoices", "Legal agreement templates", "Payment tracking", "Priority support"],
      cta: "Go Pro",
      popular: true,
    },
    {
      name: "Business",
      price: "Custom",
      desc: "For agencies & teams",
      features: ["Everything in Pro", "Team seats & roles", "Custom branding", "Dedicated manager"],
      cta: "Contact sales",
      popular: false,
    },
  ];

  return (
    <section className="py-20 sm:py-28 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Simple pricing"
          title="Pay for what you need"
          subtitle="No platform fees on deal value. Upgrade only when you want more credits or team seats."
        />

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-14 max-w-5xl mx-auto"
        >
          {plans.map((p) => (
            <motion.div
              key={p.name}
              variants={fadeUp}
              className={`relative rounded-2xl border p-6 transition-all ${
                p.popular
                  ? "border-emerald-500 bg-white dark:bg-neutral-900 shadow-xl shadow-emerald-500/15 scale-[1.02]"
                  : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50"
              }`}
            >
              {p.popular && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold text-white uppercase tracking-widest"
                  style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
                >
                  Most popular
                </div>
              )}
              <p className="text-sm font-semibold">{p.name}</p>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight">{p.price}</span>
                {p.per && <span className="text-sm text-neutral-500">{p.per}</span>}
              </div>
              <p className="text-xs text-neutral-500 mt-1">{p.desc}</p>
              <ul className="mt-5 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                    <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                onClick={onCTA}
                className={`w-full mt-6 h-10 text-sm font-semibold ${
                  p.popular
                    ? "text-white border-0 shadow-md shadow-emerald-500/20"
                    : "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700"
                }`}
                style={p.popular ? { background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" } : undefined}
              >
                {p.cta}
              </Button>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function FAQSection() {
  return (
    <section id="faq" className="py-20 sm:py-28">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="FAQ"
          title="Questions, answered"
          subtitle="Still curious? Our team replies to every email within 24 hours."
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-12"
        >
          <Accordion type="single" collapsible className="space-y-3">
            {FAQS.map((f, i) => (
              <AccordionItem
                key={f.q}
                value={`faq-${i}`}
                className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 px-5 data-[state=open]:shadow-md data-[state=open]:shadow-emerald-500/5"
              >
                <AccordionTrigger className="text-left text-sm font-semibold py-4 hover:no-underline">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed pb-4">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </section>
  );
}

function FinalCTA({ isAuthenticated, onCTA }: { isAuthenticated: boolean; onCTA: () => void }) {
  return (
    <section className="py-20 sm:py-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative rounded-3xl overflow-hidden p-10 sm:p-16 text-center"
          style={{ background: "linear-gradient(135deg, #065F46 0%, #0F766E 50%, #115E59 100%)" }}
        >
          {/* Decorative shapes */}
          <div className="absolute -top-20 -left-20 w-80 h-80 rounded-full blur-3xl opacity-30" style={{ background: "radial-gradient(circle, #34D399, transparent)" }} />
          <div className="absolute -bottom-20 -right-20 w-80 h-80 rounded-full blur-3xl opacity-30" style={{ background: "radial-gradient(circle, #5EEAD4, transparent)" }} />

          <div className="relative">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm mb-5">
              <Zap className="w-3.5 h-3.5 text-emerald-200" />
              <span className="text-xs font-semibold text-emerald-50">Ready to level up your deals?</span>
            </div>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white mb-4">
              Start closing better deals<br />in the next 60 seconds.
            </h2>
            <p className="text-base sm:text-lg text-emerald-100/90 max-w-xl mx-auto mb-8">
              Join 10,000+ creators running their collaborations like a business. Free to start — no credit card required.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                onClick={onCTA}
                className="h-12 px-6 text-sm font-semibold bg-white text-emerald-700 hover:bg-neutral-100 border-0 shadow-xl"
                data-testid="button-final-cta"
              >
                {isAuthenticated ? "Go to Dashboard" : "Create free account"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <a
                href="#features"
                className="h-12 px-6 inline-flex items-center justify-center text-sm font-semibold rounded-md border border-white/30 text-white hover:bg-white/10 transition-colors"
              >
                Explore features
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-950 relative z-[1]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          <div className="col-span-2 md:col-span-1">
            <DealinsecLogo size="md" withText />
            <p className="text-xs text-neutral-500 mt-4 leading-relaxed max-w-[220px]">
              Turning creator collaborations into professional deals.
            </p>
            <div className="flex items-center gap-3 mt-4">
              {[SiInstagram, SiX, SiYoutube, SiLinkedin].map((Icon, i) => (
                <a key={i} href="#" className="text-neutral-400 hover:text-emerald-600 transition-colors">
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          <FooterColumn
            title="Product"
            links={[
              { label: "Features", href: "#features" },
              { label: "How it works", href: "#how" },
              { label: "Showcase", href: "#showcase" },
              { label: "Pricing", href: "/pricing" },
            ]}
          />
          <FooterColumn
            title="Company"
            links={[
              { label: "Pitch", href: "/pitch" },
              { label: "Terms", href: "/terms" },
              { label: "Privacy", href: "/privacy" },
              { label: "Refund Policy", href: "/refund" },
            ]}
          />
          <FooterColumn
            title="Resources"
            links={[
              { label: "Cookies", href: "/cookies" },
              { label: "Contact", href: "mailto:hello@dealinsec.com" },
            ]}
          />
        </div>

        <div className="pt-6 border-t border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-500">
          <p>© {new Date().getFullYear()} Dealinsec. Made with care in India.</p>
          <p className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-emerald-600" />
            <span>Secured with 256-bit encryption</span>
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest font-semibold text-neutral-900 dark:text-white mb-4">{title}</p>
      <ul className="space-y-2.5">
        {links.map((l) => {
          const isHashOrExternal = l.href.startsWith("#") || l.href.startsWith("mailto:");
          if (isHashOrExternal) {
            return (
              <li key={l.label}>
                <a href={l.href} className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                  {l.label}
                </a>
              </li>
            );
          }
          return (
            <li key={l.label}>
              <Link href={l.href} className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      className="text-center max-w-2xl mx-auto"
    >
      <p className="text-xs uppercase tracking-widest font-semibold text-emerald-600 dark:text-emerald-400 mb-3">
        {eyebrow}
      </p>
      <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.1] mb-4">
        {title}
      </h2>
      <p className="text-base text-neutral-600 dark:text-neutral-400 leading-relaxed">
        {subtitle}
      </p>
    </motion.div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Small form helpers
// ────────────────────────────────────────────────────────────────────────────

function FieldGroup({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
        {label}
      </Label>
      {children}
    </div>
  );
}

function GoogleButton({ referralCode }: { referralCode: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = referralCode ? `/api/auth/google?ref=${referralCode}` : "/api/auth/google";
      }}
      className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors text-sm font-medium"
    >
      <SiGoogle className="h-4 w-4 text-emerald-600" />
      <span>Continue with Google</span>
    </button>
  );
}

function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-neutral-500 my-4">
      <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
      <span className="uppercase tracking-wider">or</span>
      <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
    </div>
  );
}
