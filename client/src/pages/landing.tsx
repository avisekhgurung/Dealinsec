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
  ReceiptText,
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
  Users,
  Lightbulb,
  Camera,
  PenTool,
  Calculator,
  ClipboardList,
  Building2,
  Sofa,
  DraftingCompass,
  Megaphone,
  HardHat,
  Infinity as InfinityIcon,
  UserPlus,
  ShieldCheck,
  ScrollText,
  Radar,
  Navigation,
  MessageSquare,
} from "lucide-react";
import { SiGoogle, SiInstagram, SiYoutube, SiX, SiFacebook, SiLinkedin } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { trackEvent } from "@/lib/analytics";
import { LandingCopilot, LandingCopilotSection } from "@/components/landing-copilot";
import { DealinsecLogo } from "@/components/dealinsec-logo";

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

// Server-rendered routes that live OUTSIDE the React SPA (Express pages).
// Links to these must be plain <a> navigations — wouter has no such routes
// and would silently swallow the click. ONE list, used by header and footer.
const SERVER_ROUTE_PREFIXES = [
  "/tools",
  "/blog",
  "/quotation-software",
  "/contract-management",
  "/proposal-management",
  "/invoice-management",
  "/e-signature",
  "/interior-design-software",
  "/refrens-alternative",
  "/vyapar-alternative",
];
const isServerRoute = (href: string) => SERVER_ROUTE_PREFIXES.some((p) => href.startsWith(p));

const NAV_LINKS = [
  { label: "Free Tools", href: "/tools" },
  { label: "Blog", href: "/blog" },
  { label: "Who it's for", href: "#who" },
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

const DASHBOARD_LINKS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Deals", href: "/deals", icon: Briefcase },
  { label: "Agreements", href: "/contracts", icon: FileCheck },
  { label: "Invoices", href: "/invoices", icon: Receipt },
  { label: "Profile", href: "/profile", icon: UserCircle },
];

const FEATURES = [
  {
    icon: Briefcase,
    title: "Deal Management",
    desc: "Track every mandate, project and retainer — scope, timelines and pricing in one clean dashboard.",
    tint: "emerald",
  },
  {
    icon: FileText,
    title: "Instant Quotations",
    desc: "Per sq ft, milestone or retainer — professional quotes in under 60 seconds, on your terms.",
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
    desc: "Advance & final invoices with your banking details baked in. Track every rupee of every milestone.",
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
    desc: "Encrypted storage, e-sign audit trails, and session-level data protection.",
    tint: "rose",
  },
];

const WORKFLOW_STEPS = [
  {
    step: "01",
    icon: Briefcase,
    title: "Create Deal",
    desc: "Set up the deal — client, scope, timeline, payment terms.",
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
  { value: "5-in-1", label: "One workflow", sub: "Deals · Quotes · Contracts · Invoices · Insights" },
  { value: "60s", label: "To your first invoice", sub: "From signup to sent" },
  { value: "₹0", label: "Platform fee", sub: "On every deal you close" },
  { value: "PAN·GSTIN", label: "On your documents", sub: "Bank details built in" },
];

// Testimonials removed: the named people, cities and 5-star ratings here were
// invented, and presenting invented reviews as real customers is deceptive
// under the Consumer Protection Act, 2019. Put them back only with real quotes
// from real customers who agreed to be named. Until then the section below
// says something true instead.

const FAQS = [
  {
    q: "Who is DealInSec built for?",
    a: "Deal-led service businesses — real estate brokers and consultants, interior designers, architects, marketing and digital agencies, and construction contractors. If you quote, sign and bill clients, the workflow fits: deal â quotation â agreement â invoice â payment tracking. DealInSec never touches your clients’ money â you record payments, we keep the register.",
  },
  {
    q: "Is Dealinsec free to use?",
    a: "Yes — every new account starts with a 7-day Pro trial: everything unlocked, no card needed. After that the free plan covers 4 deals every month, each with a professional quotation. Signed agreements, invoices and payment tracking are part of DealInSec Pro (₹999/month or ₹9,999/year). There are no platform fees on your deal value.",
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

const WHO_WE_SERVE = [
  {
    icon: Building2,
    title: "Real Estate",
    tagline: "Sales · Rentals · Leasing",
    desc: "Brokers and consultants closing property deals with proper mandates, agreements and brokerage invoices.",
    accent: "emerald",
  },
  {
    icon: Sofa,
    title: "Interior Designers",
    tagline: "Homes · Offices · Retail",
    desc: "Studios quoting per sq ft or turnkey, signing scope before work starts, and billing by milestone.",
    accent: "teal",
  },
  {
    icon: DraftingCompass,
    title: "Architects",
    tagline: "Design · Drawings · PMC",
    desc: "Firms billing stage-wise design fees, protecting drawings with agreements, and tracking every payment.",
    accent: "cyan",
  },
  {
    icon: Megaphone,
    title: "Agencies",
    tagline: "Marketing · Digital · Web",
    desc: "Marketing, creative and web agencies running client retainers, campaigns and project billing in one place.",
    accent: "indigo",
  },
  {
    icon: HardHat,
    title: "Construction",
    tagline: "Civil · Turnkey · Trades",
    desc: "Contractors managing works contracts, RA bills and milestone payments without the paperwork chaos.",
    accent: "amber",
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

// Above-the-fold HERO variants: opacity stays 1 so the LCP hero text paints
// immediately (good for Core Web Vitals) and is never blank if animations are
// paused (crawlers, reduced-motion, backgrounded tab). Only a subtle slide-up.
const heroStagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.03 } },
};
const heroFadeUp = {
  hidden: { y: 14 },
  visible: { y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The auth experience is a dedicated page now (professional split-screen
  // + forgot-password flow) — the popup stays only as dead markup until a
  // future cleanup pass.
  const openAuth = (tab: "signup" | "login") => {
    setLocation(tab === "login" ? "/auth?mode=signin" : "/auth?mode=signup");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/auth/login", { email: loginEmail, password: loginPassword });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setAuthModalOpen(false);
      setLocation("/dashboard");
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
      trackEvent("sign_up", { method: "email" });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setAuthModalOpen(false);
      setLocation("/dashboard");
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
          isAuthenticated={isAuthenticated}
          onPrimaryClick={() => (isAuthenticated ? setLocation("/dashboard") : openAuth("signup"))}
        />
        <TrustStrip />
        <WhoWeServeSection />
        <FreeToolsSection />
        <FeatureGrid />
        <WorkflowSection />
        <ProductShowcase />
        <StatsSection />
        <WatchesSection />

        {/* The chat sits open in the page — a visitor who never clicks a
            floating bubble still finds something they can use right now. */}
        <LandingCopilotSection
          onCta={() => (isAuthenticated ? setLocation("/dashboard") : openAuth("signup"))}
        />
        <TeamSection />
        {/* Testimonials hidden until we have real users. Re-enable <Testimonials /> once you have genuine quotes. */}
        <MadeInIndiaSection />
        <PricingPreview onCTA={() => (isAuthenticated ? setLocation("/pricing") : openAuth("signup"))} />
        <FAQSection />
        <FinalCTA
          isAuthenticated={isAuthenticated}
          onCTA={() => (isAuthenticated ? setLocation("/dashboard") : openAuth("signup"))}
        />
      </main>

      <Footer />

      {/* Public product guide — answers from the same knowledge base the
          in-app Copilot uses, so marketing can't drift from the product. */}
      <LandingCopilot onCta={() => (isAuthenticated ? setLocation("/dashboard") : openAuth("signup"))} />

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
                {authTab === "signup" ? "No credit card. Every Pro feature free for 7 days." : "Sign in to continue"}
              </p>
            </div>

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
                <GoogleButton />
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
                <GoogleButton />
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
                <Link href="/dashboard">
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
  // Hash anchors AND the server-rendered /tools/* pages must be real <a> links
  // (a wouter <Link> would client-route /tools into the SPA, which has no such
  // route, and fall through to the landing page).
  const isPlainAnchor = href.startsWith("#") || href.startsWith("mailto:") || isServerRoute(href);
  if (isPlainAnchor) {
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
  isAuthenticated,
  onPrimaryClick,
}: {
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
        <div className="text-center max-w-4xl mx-auto">
          <motion.div
            variants={heroStagger}
            initial="hidden"
            animate="visible"
            className="space-y-6"
          >
            <motion.div variants={heroFadeUp} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/70 dark:bg-neutral-900/70 backdrop-blur-sm border border-emerald-200/70 dark:border-emerald-800/40 shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                Deal · Sign · Secured · Made in India
              </span>
            </motion.div>

            <motion.h1
              variants={heroFadeUp}
              className="text-[2.5rem] sm:text-5xl lg:text-[4.5rem] font-bold tracking-tight leading-[1.02]"
            >
              Your deal manager for
              <br />
              <span
                className="relative inline-block"
                style={{
                  background: "linear-gradient(135deg, #059669 0%, #14B8A6 50%, #0D9488 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                getting paid & staying protected.
                <motion.span
                  className="absolute -bottom-1 left-0 right-0 h-[6px] rounded-full opacity-40"
                  style={{ background: "linear-gradient(90deg, transparent, #10B981, transparent)" }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
                />
              </span>
            </motion.h1>

            <motion.p variants={heroFadeUp} className="text-base sm:text-lg lg:text-xl text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto leading-relaxed">
              One simple workflow — quotation, e-signed agreement, professional invoice, payment tracking —{" "}
              <span className="font-semibold text-neutral-900 dark:text-white">so you look professional, never chase a client, and get paid on time.</span>{" "}
              Built for India's real estate consultants, interior designers, architects, agencies &amp; contractors.
            </motion.p>

            <motion.div variants={heroFadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Button
                onClick={onPrimaryClick}
                className="h-12 px-6 text-sm font-semibold text-white border-0 shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all w-full sm:w-auto"
                style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
                data-testid="button-hero-cta"
              >
                {isAuthenticated ? "Go to Dashboard" : "Start managing deals"}
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

            <motion.div variants={heroFadeUp} className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 pt-3 text-xs text-neutral-500">
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-500" /> 7-day Pro trial
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-500" /> ₹0 platform fee on your deals
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
              <h3 className="text-lg sm:text-xl font-bold">Meera Nair</h3>
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
                  { name: "Sharma Residence · 3BHK Interiors", status: "Paid", amount: "₹4.5L" },
                  { name: "Skyline Devs · Office Fit-out", status: "Signed", amount: "₹12L" },
                  { name: "Café Aroma · Design + Execution", status: "Quote", amount: "₹2.8L" },
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
          <p className="text-xs font-semibold">Skyline Developers LLP</p>
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
          <p className="text-xs font-semibold">₹2,25,000</p>
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
          Built for India's deal-led service sectors
        </motion.p>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-5 opacity-70">
          {[
            { Icon: Building2, name: "Real Estate" },
            { Icon: Sofa, name: "Interior Design" },
            { Icon: DraftingCompass, name: "Architecture" },
            { Icon: Megaphone, name: "Agencies" },
            { Icon: HardHat, name: "Construction" },
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

function WhoWeServeSection() {
  return (
    <section id="who" className="py-20 sm:py-28 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Who we serve"
          title={
            <>
              Built for{" "}
              <span style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                every business
              </span>{" "}
              that closes deals
            </>
          }
          subtitle="Built for the businesses that run on deals — brokers, designers, architects, agencies and contractors. One workflow from first quotation to final invoice — with every payment tracked."
        />

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 lg:gap-5 mt-14"
        >
          {WHO_WE_SERVE.map((p) => (
            <motion.div
              key={p.title}
              variants={fadeUp}
              whileHover={{ y: -4 }}
              className="group relative rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-6 hover:border-emerald-300 dark:hover:border-emerald-700/70 hover:shadow-xl hover:shadow-emerald-500/10 transition-all duration-300 overflow-hidden"
            >
              <div
                className="absolute top-0 left-0 right-0 h-1"
                style={{ background: "linear-gradient(90deg, #059669, #0D9488)" }}
              />
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-emerald-50 dark:bg-emerald-950/40 group-hover:scale-110 transition-transform">
                <p.icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex items-center gap-2 mb-1.5">
                <h3 className="text-base font-semibold">{p.title}</h3>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
                  {p.tagline}
                </span>
              </div>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{p.desc}</p>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-12 max-w-3xl mx-auto rounded-2xl border border-neutral-900/90 dark:border-neutral-700 bg-neutral-950 dark:bg-neutral-900 p-5 sm:p-6 text-center"
        >
          <p className="text-sm sm:text-base text-neutral-200 font-medium leading-relaxed">
            <span className="text-emerald-400 font-semibold">One platform.</span>{" "}
            Every deal-led business. Whether you're a solo consultant or a 50-person agency — same workflow, same simple pricing.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

const FREE_TOOLS = [
  { name: "GST Invoice Generator", href: "/tools/gst-invoice-generator", desc: "Auto CGST/SGST/IGST, amount in words, instant PDF.", icon: Receipt },
  { name: "Bill Generator", href: "/tools/bill-generator", desc: "Create a bill online in a minute — with a PAID stamp.", icon: ReceiptText },
  { name: "Quotation Maker", href: "/tools/quotation-maker", desc: "Professional quotations with line items, GST & terms.", icon: FileText },
  { name: "GST Calculator", href: "/tools/gst-calculator", desc: "Add or remove GST with the CGST/SGST or IGST split.", icon: Calculator },
  { name: "Service Agreement", href: "/tools/service-agreement-template", desc: "A ready-to-sign contract — scope, fees, editable clauses.", icon: FileSignature },
  { name: "Proforma Invoice", href: "/tools/proforma-invoice-generator", desc: "Confirm price & terms before the sale.", icon: FileCheck },
  { name: "Purchase Order", href: "/tools/purchase-order-generator", desc: "Raise a clean PO for your vendor in a minute.", icon: ClipboardList },
];

function FreeToolsSection() {
  return (
    <section id="free-tools" className="py-20 sm:py-28 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Free tools · No sign-up"
          title={
            <>
              Try it free —{" "}
              <span style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                no account needed
              </span>
            </>
          }
          subtitle="Create GST invoices, quotations and agreements right in your browser — free, instant, no sign-up. Our gift to Indian businesses. When you're ready to run whole deals, the app is one click away."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5 mt-14">
          {FREE_TOOLS.map((t) => (
            <a
              key={t.href}
              href={t.href}
              data-testid={`landing-tool-${t.href}`}
              className="group rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-6 hover:border-emerald-300 dark:hover:border-emerald-700/70 hover:shadow-xl hover:shadow-emerald-500/10 transition-all duration-300 flex flex-col"
            >
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-emerald-50 dark:bg-emerald-950/40 group-hover:scale-110 transition-transform">
                <t.icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-base font-semibold mb-1.5">{t.name}</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed flex-1">{t.desc}</p>
              <span className="mt-4 text-sm font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                Open tool <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </a>
          ))}
        </div>
        <div className="mt-10 text-center">
          <a
            href="/tools"
            className="inline-flex items-center gap-2 h-12 px-6 rounded-md text-sm font-semibold border border-neutral-300 dark:border-neutral-700 hover:bg-white dark:hover:bg-neutral-900 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
          >
            See all free tools <ArrowRight className="w-4 h-4" />
          </a>
        </div>

        {/* Sector bridge: invoice-format guides for the Phase-1 ICP (also
            internal links that help Google connect the landing to the SEO pages) */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-xs text-neutral-500">
          <span className="font-semibold uppercase tracking-wider text-[10px]">Invoice formats for your sector:</span>
          {[
            { label: "Real Estate", href: "/tools/invoice-format/for-real-estate-agents" },
            { label: "Interior Design", href: "/tools/invoice-format/for-interior-designers" },
            { label: "Architecture", href: "/tools/invoice-format/for-architects" },
            { label: "Agencies", href: "/tools/invoice-format/for-digital-marketing-agencies" },
            { label: "Construction", href: "/tools/invoice-format/for-construction-contractors" },
          ].map((s) => (
            <a
              key={s.href}
              href={s.href}
              className="px-2.5 py-1 rounded-full border border-neutral-200 dark:border-neutral-800 hover:border-emerald-300 dark:hover:border-emerald-700 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
            >
              {s.label}
            </a>
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
          subtitle="From quotation to e-signed service agreement to invoice — manage every deal from one dashboard, and get paid on time."
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
          title="From handshake to paid invoice in 4 steps"
          subtitle="Every client deal moves cleanly through the Dealinsec pipeline — no follow-ups, no lost threads."
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
      desc: "Send out quotations with standard or custom terms. Clients see a polished, branded PDF they can approve or pay instantly.",
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
          subtitle="Opinionated, fast, and designed for how service businesses actually work."
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
          <span className="font-semibold">Skyline Developers LLP</span>
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
          <p className="text-[10px] text-neutral-500">Between Meera Nair and Skyline Developers LLP</p>
        </div>
      </div>

      <div className="space-y-2 text-[11px] text-neutral-600 dark:text-neutral-400 leading-relaxed mb-5">
        <p>This agreement confirms the collaboration terms between the parties...</p>
        <p className="opacity-60">Section 1 — Scope of work · Section 2 — Compensation...</p>
        <p className="opacity-40">Section 3 — Exclusivity...</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
          <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1">Provider</p>
          <p className="text-xs font-bold italic text-emerald-700 dark:text-emerald-300" style={{ fontFamily: "Georgia, serif" }}>Meera N.</p>
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
        <div className="flex justify-between"><span className="text-neutral-500">Account holder</span><span className="font-semibold">Meera Nair</span></div>
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
          eyebrow="Why this exists"
          title="Built by someone who got tired of chasing payments."
          subtitle="DealInSec is new and we are not going to pretend otherwise with invented reviews."
        />

        <div className="max-w-3xl mx-auto mt-12">
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-7 sm:p-9">
            <p className="text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300">
              Most Indian service businesses lose money in the same three places: work that starts
              without a written scope, invoices that go out late, and payments nobody follows up on.
              Not because anyone is careless — because the quotation is in WhatsApp, the agreement is in
              email, and the invoice is in someone's Downloads folder.
            </p>
            <p className="text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300 mt-4">
              DealInSec puts those four documents on one thread, so every deal has a quotation, a signed
              agreement and an invoice that reference each other — and a number on your dashboard telling
              you what is collectible today.
            </p>
            <p className="text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300 mt-4">
              We would rather you try it for seven days and decide for yourself than read a testimonial
              from someone you have never met.
            </p>
            <div className="flex items-center gap-3 mt-7 pt-6 border-t border-neutral-200 dark:border-neutral-800">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
              >
                AG
              </div>
              <div>
                <p className="text-sm font-semibold">Avisekh Gurung</p>
                <p className="text-xs text-neutral-500">Founder, DealInSec</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


function MadeInIndiaSection() {
  return (
    <section className="py-20 sm:py-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className="relative rounded-3xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60"
        >
          {/* Tricolor ribbon */}
          <div
            className="h-1.5 w-full"
            style={{ background: "linear-gradient(90deg, #FF9933 0%, #FF9933 33%, #FFFFFF 33%, #FFFFFF 66%, #138808 66%, #138808 100%)" }}
            aria-hidden="true"
          />
          <div className="p-8 sm:p-12 text-center">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/70 dark:border-emerald-800/40 mb-5">
              <span className="text-base leading-none">&#127470;&#127475;</span>
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">Made in India</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4" style={{ textWrap: "balance" }}>
              Built in India, for the businesses{" "}
              <span
                style={{
                  background: "linear-gradient(135deg, #FF9933 0%, #E01B6F 50%, #138808 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                that build India
              </span>
            </h2>
            <p className="text-base sm:text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto leading-relaxed mb-3">
              The broker closing a family's first home. The designer turning a bare flat into
              a place someone loves coming back to. The contractor whose RA bill feeds thirty
              families. The agency putting a local brand on the map.
            </p>
            <p className="text-base sm:text-lg text-neutral-700 dark:text-neutral-300 max-w-2xl mx-auto leading-relaxed font-medium">
              Your work runs on trust and a handshake. DealInSec puts that handshake in
              writing &mdash; GST-native, &#8377;-first, and made for how Indian business actually runs.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mt-7 text-xs text-neutral-500">
              <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-500" /> GST &amp; SAC built in</span>
              <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-500" /> PAN, IFSC &amp; UPI native</span>
              <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-500" /> Priced in &#8377;, for India</span>
              <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-500" /> Built by a founder, not a giant</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function PricingPreview({ onCTA }: { onCTA: () => void }) {
  const freePerks = [
    "4 deals every month",
    "A professional quotation with each deal",
    "Dashboard & payment overview",
    "Professional quotation PDFs",
  ];
  const proMonthlyPerks = [
    "Unlimited deals & quotations",
    "Unlimited signed agreements with e-signature",
    "Unlimited professional invoices",
    "Payment tracking & reminders",
    "5 team seats · custom roles & permissions",
    "Custom branding · Priority support",
  ];
  const proAnnualPerks = [
    "Everything in Pro Monthly",
    "Unlimited workflow for a full year",
    "One payment — no monthly renewals",
    "Lock today's price for 12 months",
  ];

  return (
    <section id="pricing" className="py-20 sm:py-28 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/20 scroll-mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Simple pricing"
          title="Try everything free for 7 days."
          subtitle="Every new account starts with a 7-day Pro trial — the full workflow, unlocked. After that, stay free with 4 deals a month or go Pro for unlimited everything."
        />

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-14 max-w-6xl mx-auto"
        >
          {/* Free tier */}
          <motion.div
            variants={fadeUp}
            className="relative rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-7"
          >
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-emerald-600" />
              </div>
              <p className="text-sm font-semibold">Free</p>
            </div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight">₹0</span>
              <span className="text-sm text-neutral-500">/ forever</span>
            </div>
            <p className="text-xs text-neutral-500 mt-1">Run your pipeline professionally — deals and quotations included.</p>
            <ul className="mt-5 space-y-2.5">
              {freePerks.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Button
              onClick={onCTA}
              className="w-full mt-6 h-10 text-sm font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700"
            >
              Start free
            </Button>
            <p className="text-[11px] text-neutral-500 text-center mt-3">Starts with a 7-day Pro trial. No credit card needed.</p>
          </motion.div>

          {/* Pro Monthly — recommended */}
          <motion.div
            variants={fadeUp}
            className="relative rounded-2xl border border-violet-500 bg-white dark:bg-neutral-900 shadow-xl shadow-violet-500/15 scale-[1.02] overflow-hidden"
          >
            {/* Promo bar */}
            <div
              className="px-4 py-2 text-center text-white text-[11px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5"
              style={{ background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)" }}
            >
              <Sparkles className="w-3 h-3" />
              Recommended
              <Sparkles className="w-3 h-3" />
            </div>

            <div className="p-7">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)" }}
                  >
                    <FileSignature className="w-4 h-4 text-white" />
                  </div>
                  <p className="text-sm font-semibold">Pro · Monthly</p>
                </div>
              </div>

              <div className="mt-4 flex items-baseline gap-1">
                <span
                  className="text-4xl font-bold tracking-tight"
                  style={{
                    background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  ₹999
                </span>
                <span className="text-sm text-neutral-500">/ month</span>
              </div>
              <p className="text-xs text-neutral-500 mt-1">The complete Lead → Deal → Quote → Agreement → Invoice → Payment workflow.</p>

              <ul className="mt-5 space-y-2.5">
                {proMonthlyPerks.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                    <Check className="w-4 h-4 text-violet-600 flex-shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Button
                onClick={onCTA}
                className="w-full mt-6 h-11 text-sm font-bold text-white border-0 shadow-md shadow-violet-500/30"
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)" }}
                data-testid="button-go-pro-monthly"
              >
                Go Pro — ₹999/month
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>

              {/* Trust signals row */}
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-3 text-[10px] text-neutral-500">
                <span className="inline-flex items-center gap-1">
                  <Shield className="w-2.5 h-2.5 text-emerald-500" /> 7-day refund
                </span>
                <span className="inline-flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5 text-emerald-500" /> No auto-debit
                </span>
                <span className="inline-flex items-center gap-1">
                  <Check className="w-2.5 h-2.5 text-emerald-500" /> UPI · Cards · NetBanking
                </span>
              </div>
            </div>
          </motion.div>

          {/* Pro Annual — save 2 months */}
          <motion.div
            variants={fadeUp}
            className="relative rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-7 flex flex-col"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center">
                  <InfinityIcon className="w-4 h-4 text-amber-600" />
                </div>
                <p className="text-sm font-semibold">Pro · Annual</p>
              </div>
              <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                Save 2 Months
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight">₹9,999</span>
              <span className="text-sm text-neutral-500">/ year</span>
            </div>
            <p className="text-xs text-neutral-500 mt-1">≈ ₹833/month — two months free vs paying monthly.</p>
            <ul className="mt-5 space-y-2.5 flex-1">
              {proAnnualPerks.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                  <Check className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Button
              onClick={onCTA}
              className="w-full mt-6 h-11 text-sm font-bold text-white border-0 shadow-md shadow-amber-500/30"
              style={{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" }}
              data-testid="button-go-pro"
            >
              Go Annual — ₹9,999/year
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <p className="text-[11px] text-neutral-500 text-center mt-3">One payment, not auto-renewing.</p>
          </motion.div>
        </motion.div>

        {/* What's free vs. what costs a credit */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-10 max-w-4xl mx-auto rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 overflow-hidden"
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-neutral-200 dark:divide-neutral-800">
            {[
              { step: "1", title: "Create Deal", cost: "Free · 4/mo", icon: Briefcase },
              { step: "2", title: "Send Quote", cost: "Included", icon: FileText },
              { step: "3", title: "Sign Agreement", cost: "Pro", icon: FileSignature, highlight: true },
              { step: "4", title: "Invoice & get paid", cost: "Pro", icon: Receipt, highlight: true },
            ].map((s) => (
              <div key={s.step} className={`p-4 text-center ${s.highlight ? "bg-emerald-50/70 dark:bg-emerald-950/20" : ""}`}>
                <div className={`w-9 h-9 mx-auto rounded-lg flex items-center justify-center mb-2 ${s.highlight ? "bg-emerald-600 text-white" : "bg-neutral-100 dark:bg-neutral-800 text-emerald-600"}`}>
                  <s.icon className="w-4 h-4" />
                </div>
                <p className="text-xs font-semibold">{s.title}</p>
                <p className={`text-[11px] mt-0.5 font-semibold ${s.highlight ? "text-emerald-700 dark:text-emerald-300" : "text-neutral-500"}`}>
                  {s.cost}
                </p>
              </div>
            ))}
          </div>
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
              <span className="text-xs font-semibold text-emerald-50">Your next deal is seconds away.</span>
            </div>
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white mb-4">
              Deals in seconds.<br />Secured for life.
            </h2>
            <p className="text-base sm:text-lg text-emerald-100/90 max-w-xl mx-auto mb-8">
              Join brokers, designers, architects, agencies and contractors closing professional deals — quoted, signed, invoiced and paid. Free to start, no credit card required.
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
        {/* Newsletter strip */}
        <NewsletterStrip />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10 mt-12">
          <div className="col-span-2 md:col-span-1">
            <DealinsecLogo size="md" withText />
            <p className="text-xs text-neutral-500 mt-4 leading-relaxed max-w-[240px]">
              The deal-management OS for India's service sectors — real estate, interiors, architecture, agencies and construction. Quote, sign, bill and get paid in one workflow.
            </p>
            <div className="flex items-center gap-3 mt-5">
              {[
                { Icon: SiInstagram, href: "https://www.instagram.com/dealinsec", label: "Instagram" },
                { Icon: SiLinkedin, href: "https://www.linkedin.com/company/dealinsec", label: "LinkedIn" },
                { Icon: SiX, href: "https://x.com/dealinsec", label: "X" },
              ].map(({ Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-500 hover:text-emerald-600 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
                >
                  <Icon className="w-3.5 h-3.5" />
                </a>
              ))}
            </div>
          </div>

          <FooterColumn
            title="Product"
            links={[
              { label: "Quotation Software", href: "/quotation-software" },
              { label: "Contract Management", href: "/contract-management" },
              { label: "Proposal Management", href: "/proposal-management" },
              { label: "Invoice Management", href: "/invoice-management" },
              { label: "E-Signature", href: "/e-signature" },
              { label: "Pricing", href: "#pricing" },
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
              { label: "Free Tools", href: "/tools" },
              { label: "Blog", href: "/blog" },
              { label: "Cookies", href: "/cookies" },
              { label: "Contact", href: "mailto:support@dealinsec.com" },
            ]}
          />
        </div>

        {/* Trust badges */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-6 border-b border-neutral-200 dark:border-neutral-800">
          {[
            { Icon: Shield, text: "256-bit encrypted" },
            { Icon: Lock, text: "Pro purchases secured by Razorpay" },
            { Icon: Check, text: "UPI · Cards · NetBanking" },
            { Icon: Zap, text: "7-day Pro trial · Pro from ₹999/month" },
          ].map(({ Icon, text }) => (
            <span key={text} className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
              <Icon className="w-3.5 h-3.5 text-emerald-600" />
              {text}
            </span>
          ))}
        </div>

        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-500">
          <p>© {new Date().getFullYear()} DealInSec. All rights reserved.</p>
          <a href="mailto:support@dealinsec.com" className="hover:text-emerald-600 transition-colors">
            support@dealinsec.com
          </a>
        </div>
      </div>
    </footer>
  );
}

function NewsletterStrip() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const subscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), source: "footer" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Could not subscribe");
      }
      setDone(true);
      setEmail("");
    } catch (err: any) {
      toast({ title: "Hmm, that didn't work", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-6 lg:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
      <div className="max-w-md">
        <h3 className="text-lg lg:text-xl font-bold text-neutral-900 dark:text-white">
          Deal tips, straight to your inbox
        </h3>
        <p className="text-sm text-neutral-500 mt-1">
          Get practical tips on closing client deals, pricing your work, and getting paid on time. No spam.
        </p>
      </div>
      {done ? (
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-sm">
          <Check className="w-5 h-5" />
          You're in! Check your inbox soon.
        </div>
      ) : (
        <form onSubmit={subscribe} className="flex w-full lg:w-auto gap-2">
          <Input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 lg:w-64 bg-white dark:bg-neutral-900"
            data-testid="input-newsletter-email"
          />
          <Button
            type="submit"
            disabled={loading}
            className="h-11 px-5 text-sm font-semibold text-white border-0 shrink-0"
            style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
            data-testid="button-newsletter-subscribe"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Subscribe"}
          </Button>
        </form>
      )}
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest font-semibold text-neutral-900 dark:text-white mb-4">{title}</p>
      <ul className="space-y-2.5">
        {links.map((l) => {
          const isHashOrExternal =
            l.href.startsWith("#") || l.href.startsWith("mailto:") || isServerRoute(l.href);
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

// ── The moat: DealInSec doesn't just store deals, it watches them ──
function WatchesSection() {
  const CAPABILITIES = [
    {
      Icon: Radar,
      title: "Money Radar",
      line: "One number for everything you can collect right now — overdue, due this week, and signed work you haven't invoiced yet.",
      quote: "₹2,84,500 potentially collectible",
    },
    {
      Icon: ShieldCheck,
      title: "Deal Health",
      line: "Every deal scored on the signals that actually matter: agreement signed, money invoiced, payment overdue, timeline slipping.",
      quote: "92 / 100 · Healthy",
    },
    {
      Icon: Navigation,
      title: "Next Best Action",
      line: "No more wondering what's pending. Each deal says exactly what to do next, in the order that gets you paid.",
      quote: "Invoice the remaining ₹40,000",
    },
    {
      Icon: MessageSquare,
      title: "Payment Chaser",
      line: "Awkward follow-ups written for you from the real invoice — friendly to firm. You review, copy, send. Never automatic.",
      quote: "\"Hi Rahul — quick follow-up on INV-1042…\"",
    },
  ];
  return (
    <section className="py-20 sm:py-28 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Why DealInSec"
          title="Most tools store your deals. DealInSec watches them."
          subtitle="Spreadsheets and invoice apps wait for you to remember. DealInSec reviews every active deal and tells you what needs attention, what could cost you money, and what to do next."
        />
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid sm:grid-cols-2 gap-5 mt-14 max-w-5xl mx-auto"
        >
          {CAPABILITIES.map((c) => (
            <motion.div key={c.title} variants={fadeUp} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center mb-4">
                <c.Icon className="w-5 h-5 text-emerald-600" />
              </div>
              <h3 className="font-semibold text-lg">{c.title}</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1.5 leading-relaxed">{c.line}</p>
              <p className="mt-4 text-sm font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-lg px-3 py-2 tabular-nums">
                {c.quote}
              </p>
            </motion.div>
          ))}
        </motion.div>
        <p className="text-center text-xs text-neutral-500 mt-8 max-w-xl mx-auto">
          Every figure comes from your own deals — DealInSec never invents numbers, and never messages a client without your approval.
        </p>
      </div>
    </section>
  );
}

// ── Team & roles — the multiplayer pitch ────────────────────────────────────
function TeamSection() {
  const MATRIX_ROWS = [
    { module: "Deals", site: true, jr: true, acc: false },
    { module: "Agreements", site: false, jr: false, acc: false },
    { module: "Invoices", site: false, jr: false, acc: true },
    { module: "Payments", site: false, jr: false, acc: true },
  ];
  const cell = (on: boolean, key: string) => (
    <td key={key} className="text-center py-1.5">
      <span className={`inline-flex items-center justify-center w-4 h-4 rounded ${on ? "bg-emerald-500/15" : "bg-neutral-200/60 dark:bg-neutral-800"}`}>
        {on
          ? <Check className="w-2.5 h-2.5 text-emerald-600" strokeWidth={3.5} />
          : <X className="w-2.5 h-2.5 text-neutral-400" strokeWidth={3} />}
      </span>
    </td>
  );
  return (
    <section className="py-20 sm:py-28 border-t border-neutral-200 dark:border-neutral-800 scroll-mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Built for teams"
          title="Your whole team. You decide who does what."
          subtitle="Invite your site engineers, junior sales and accountant — everyone works in one workspace, and you control exactly what each person can see and do."
        />
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid md:grid-cols-3 gap-5 mt-14 max-w-6xl mx-auto"
        >
          <motion.div variants={fadeUp} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-6">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center mb-4">
              <UserPlus className="w-5 h-5 text-emerald-600" />
            </div>
            <h3 className="font-semibold text-lg">Invite your team</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1.5 leading-relaxed">
              5 team seats on Pro — included in your free trial too. Everyone sees the
              organization's deals, quotes and invoices in one place.
            </p>
          </motion.div>
          <motion.div variants={fadeUp} className="rounded-2xl border border-emerald-300/50 dark:border-emerald-800/50 bg-white dark:bg-neutral-900/50 p-6 shadow-lg shadow-emerald-500/[0.06]">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center mb-4">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
            </div>
            <h3 className="font-semibold text-lg">Control every permission</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1.5 leading-relaxed mb-4">
              Use the ready-made roles or create your own — a full permission matrix
              decides who can create, edit or delete in every module.
            </p>
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden text-[11px]">
              <table className="w-full">
                <thead>
                  <tr className="bg-neutral-50 dark:bg-neutral-900 text-neutral-500">
                    <th className="text-left font-semibold px-2.5 py-1.5">Module</th>
                    <th className="font-semibold px-1 py-1.5">Site Eng.</th>
                    <th className="font-semibold px-1 py-1.5">Jr. Sales</th>
                    <th className="font-semibold px-1 py-1.5">Accounts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {MATRIX_ROWS.map((r) => (
                    <tr key={r.module}>
                      <td className="px-2.5 py-1.5 font-medium text-neutral-700 dark:text-neutral-300">{r.module}</td>
                      {cell(r.site, r.module + "-s")}
                      {cell(r.jr, r.module + "-j")}
                      {cell(r.acc, r.module + "-a")}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
          <motion.div variants={fadeUp} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-6">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center mb-4">
              <ScrollText className="w-5 h-5 text-emerald-600" />
            </div>
            <h3 className="font-semibold text-lg">Every action logged</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1.5 leading-relaxed">
              Deals created, agreements signed, payments recorded — the activity log
              shows who did what and when, across your whole organization.
            </p>
          </motion.div>
        </motion.div>
      </div>
    </section>
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

function GoogleButton() {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = "/api/auth/google";
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
