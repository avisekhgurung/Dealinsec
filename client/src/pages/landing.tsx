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
  Clock,
  Globe,
  Lightbulb,
  Camera,
  PenTool,
  PenLine,
  Code2,
  Clapperboard,
  Megaphone,
  Calculator,
  ClipboardList,
  Infinity as InfinityIcon,
  ShieldCheck,
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
import { BRAND_GRADIENT, GradientText, SectionHeader, fadeUp, stagger } from "@/components/landing-shared";
import { LandingTryDemo } from "@/components/landing-try-demo";
import {
  ProblemSection,
  HowItWorksSection,
  ScopeSection,
  PaymentTrackingSection,
  ProfessionalSection,
  GlobalSection,
  AiSection,
  FeatureGroupsSection,
} from "@/components/landing-sections";
import { LANDING_FAQS } from "@shared/landing-faqs";

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
  "/freelancer-invoice-software",
  "/refrens-alternative",
  "/vyapar-alternative",
];
const isServerRoute = (href: string) => SERVER_ROUTE_PREFIXES.some((p) => href.startsWith(p));

const NAV_LINKS = [
  { label: "Product", href: "#features" },
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




// Testimonials removed: the named people, cities and 5-star ratings here were
// invented, and presenting invented reviews as real customers is deceptive
// under the Consumer Protection Act, 2019. Put them back only with real quotes
// from real customers who agreed to be named. Until then the section below
// says something true instead.

const FAQS = LANDING_FAQS;

// The six craft deal types freelancers pick from (shared/dealTypeTaxonomy.ts),
// in taxonomy order — Custom is intentionally omitted from marketing cards.
const WHO_WE_SERVE = [
  {
    icon: PenTool,
    title: "Design",
    tagline: "Brand · UI/UX · Social",
    desc: "Scope and revision count agreed before the first draft, advance taken in writing, invoice out the day the files go.",
    accent: "emerald",
  },
  {
    icon: Code2,
    title: "Development",
    tagline: "Web · App · No-code",
    desc: "Quote milestone by milestone, get the scope signed before you write a line, and see exactly which milestone is still unpaid.",
    accent: "teal",
  },
  {
    icon: PenLine,
    title: "Writing",
    tagline: "Content · Copy · Ghostwriting",
    desc: "Per piece, per word or monthly retainer — the rate, the deadline and the revision limit on record instead of in a chat.",
    accent: "cyan",
  },
  {
    icon: Megaphone,
    title: "Marketing",
    tagline: "Social · Ads · SEO",
    desc: "Retainers with a written deliverable list, so \"just one more post\" becomes a line item instead of a favour.",
    accent: "indigo",
  },
  {
    icon: Clapperboard,
    title: "Video & Photo",
    tagline: "Editing · Shoots · Reels",
    desc: "Shoot dates, deliverables and usage in one signed agreement — and a register that shows who still owes for last month's edit.",
    accent: "amber",
  },
  {
    icon: Lightbulb,
    title: "Consulting",
    tagline: "Advisory · Retainers · Coaching",
    desc: "Hourly, retainer or milestone fees agreed up front, invoiced on time, and followed up without the awkward phone call.",
    accent: "teal",
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────


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
        {!isAuthenticated && <LandingTryDemo />}
        <ProblemSection />
        <HowItWorksSection />
        <ScopeSection />
        <PaymentTrackingSection />
        <ProfessionalSection />
        <GlobalSection />
        <AiSection onCta={() => (isAuthenticated ? setLocation("/dashboard") : openAuth("signup"))} />
        <FeatureGroupsSection />
        <WhoWeServeSection />
        <FreeToolsSection />
        {/* A live, no-sign-up product guide — answers from the same knowledge
            base the app uses, so marketing can't drift from the product. */}
        <LandingCopilotSection
          onCta={() => (isAuthenticated ? setLocation("/dashboard") : openAuth("signup"))}
        />
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
                  Start for free
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
                    Start for free
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
  const floatY = useTransform(scrollYProgress, [0, 1], [0, -40]);

  return (
    <section ref={heroRef} className="relative pt-12 sm:pt-16 lg:pt-24 pb-16 lg:pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-4xl mx-auto">
          <motion.div variants={heroStagger} initial="hidden" animate="visible" className="space-y-6">
            <motion.p
              variants={heroFadeUp}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/70 dark:bg-neutral-900/70 backdrop-blur-sm border border-emerald-200/70 dark:border-emerald-800/40 shadow-sm text-[11px] font-bold tracking-[0.14em] text-emerald-700 dark:text-emerald-300"
            >
              <Globe className="w-3.5 h-3.5" />
              BUILT FOR FREELANCERS WORLDWIDE
            </motion.p>

            <motion.h1
              variants={heroFadeUp}
              className="text-[2.6rem] sm:text-6xl lg:text-[4.75rem] font-bold tracking-tight leading-[1.03] text-balance"
            >
              Turn client conversations
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
                into professional deals.
                <motion.span
                  className="absolute -bottom-1 left-0 right-0 h-[6px] rounded-full opacity-40"
                  style={{ background: "linear-gradient(90deg, transparent, #10B981, transparent)" }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
                />
              </span>
            </motion.h1>

            <motion.p
              variants={heroFadeUp}
              className="text-base sm:text-lg lg:text-xl text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto leading-relaxed text-pretty"
            >
              Paste what your client wants. DealInSec turns it into a structured deal, checks for risky terms, and helps you go from quotation to agreement to invoice.
            </motion.p>

            <motion.div variants={heroFadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              {isAuthenticated ? (
                <Button
                  onClick={onPrimaryClick}
                  className="h-12 px-7 text-[15px] font-semibold text-white border-0 shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all w-full sm:w-auto"
                  style={{ background: BRAND_GRADIENT }}
                  data-testid="button-hero-cta"
                >
                  Go to Dashboard
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              ) : (
                <a
                  href="#try"
                  onClick={() => trackEvent("hero_cta_click", { label: "try_it_free" })}
                  className="h-12 px-7 inline-flex items-center justify-center text-[15px] font-semibold rounded-md text-white border-0 shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all w-full sm:w-auto"
                  style={{ background: BRAND_GRADIENT }}
                  data-testid="button-hero-cta"
                >
                  Try it free
                  <ArrowRight className="w-4 h-4 ml-2" />
                </a>
              )}
              <a
                href="#how"
                onClick={() => trackEvent("hero_cta_click", { label: "see_how_it_works" })}
                className="h-12 px-7 inline-flex items-center justify-center text-[15px] font-semibold rounded-md border border-neutral-300 dark:border-neutral-700 bg-white/60 dark:bg-neutral-900/60 backdrop-blur-sm hover:bg-white dark:hover:bg-neutral-900 w-full sm:w-auto transition-colors"
                data-testid="link-hero-how"
              >
                See how it works
                <ChevronRight className="w-4 h-4 ml-1" />
              </a>
            </motion.div>

            <motion.p variants={heroFadeUp} className="text-xs sm:text-sm text-neutral-500">
              No credit card required · Professional documents · Multiple currencies
            </motion.p>
          </motion.div>
        </div>

        {/* Larger product preview — sits outside the text column so it can breathe */}
        <motion.div
          style={{ y: floatY }}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="mt-12 lg:mt-16 relative"
        >
          <ProductPreview />
        </motion.div>
      </div>
    </section>
  );
}

const PREVIEW_STEPS = [
  { label: "Client", state: "done" },
  { label: "Quote", state: "done" },
  { label: "Agreement", state: "done" },
  { label: "Invoice", state: "done" },
  { label: "Payment", state: "pending" },
] as const;

function ProductPreview() {
  return (
    <div className="relative max-w-6xl mx-auto">
      <div
        className="absolute inset-x-0 -top-12 h-64 blur-3xl opacity-60 pointer-events-none"
        style={{ background: "radial-gradient(60% 80% at 50% 50%, rgba(16,185,129,0.35), transparent)" }}
      />

      <div className="relative rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-2xl shadow-emerald-900/10 overflow-hidden text-left">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60">
          <span className="w-3 h-3 rounded-full bg-red-400/80" />
          <span className="w-3 h-3 rounded-full bg-amber-400/80" />
          <span className="w-3 h-3 rounded-full bg-emerald-400/80" />
          <div className="ml-3 flex-1 max-w-xs mx-auto h-6 rounded-md bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center gap-1.5 text-[10px] text-neutral-500">
            <Lock className="w-2.5 h-2.5" /> dealinsec.com/deals
          </div>
        </div>

        <div className="p-4 sm:p-7 lg:p-9 bg-gradient-to-br from-white to-emerald-50/30 dark:from-neutral-900 dark:to-emerald-950/10">
          {/* One deal, end to end */}
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/80 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold">Client · Cedar &amp; Co</p>
                <h3 className="text-lg sm:text-2xl font-bold mt-0.5">Website redesign</h3>
                <p className="text-xs text-neutral-500 mt-0.5">Deal DL-0007 · 4 weeks</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold">Deal value</p>
                <p className="text-xl sm:text-3xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">$3,200</p>
              </div>
            </div>

            <ol className="grid grid-cols-5 gap-1.5 sm:gap-3 mt-6">
              {PREVIEW_STEPS.map((s, i) => (
                <li key={s.label} className="min-w-0">
                  <div
                    className={`h-1.5 rounded-full ${s.state === "done" ? "" : "bg-amber-300 dark:bg-amber-500/70"}`}
                    style={s.state === "done" ? { background: BRAND_GRADIENT } : undefined}
                  />
                  <p className="flex items-center gap-1 mt-2 text-[9px] sm:text-xs font-semibold truncate">
                    {s.state === "done" ? (
                      <Check className="hidden sm:block w-3 h-3 text-emerald-600 shrink-0" />
                    ) : (
                      <Clock className="hidden sm:block w-3 h-3 text-amber-500 shrink-0" />
                    )}
                    <span className="truncate">{s.label}</span>
                  </p>
                  <p className="hidden sm:block text-[10px] text-neutral-500 mt-0.5 truncate">
                    {["Added", "Accepted", "Signed", "Sent · $1,600", "Pending"][i]}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
            {[
              { label: "Total invoiced", value: "$4,850", cls: "" },
              { label: "Paid", value: "$3,200", cls: "text-emerald-600 dark:text-emerald-400" },
              { label: "Pending", value: "$1,150", cls: "text-amber-600 dark:text-amber-400" },
              { label: "Overdue", value: "$500", cls: "text-rose-600 dark:text-rose-400" },
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
                <p className={`text-lg sm:text-2xl font-bold mt-1 tabular-nums ${s.cls}`}>{s.value}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Three quiet status chips straddling the card edge (never over content) — md+ only */}
      {[
        { Icon: FileSignature, small: "Agreement signed", big: "Cedar & Co", pos: "-top-5 left-[7%]", delay: 0 },
        { Icon: Check, small: "Invoice paid", big: "$2,000", pos: "-top-5 right-[7%]", delay: 1 },
        { Icon: Clock, small: "Payment pending", big: "$1,150", pos: "-bottom-5 right-[10%]", delay: 2 },
      ].map(({ Icon, small, big, pos, delay }) => (
        <motion.div
          key={small}
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay }}
          className={`hidden md:flex absolute ${pos} items-center gap-2 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xl shadow-emerald-900/10 px-3 py-2`}
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
            <Icon className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <p className="text-[10px] text-neutral-500">{small}</p>
            <p className="text-xs font-semibold">{big}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function WhoWeServeSection() {
  return (
    <section id="who" className="py-20 sm:py-28 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Who it's for"
          title={
            <>
              Built for <GradientText>independent professionals</GradientText>
            </>
          }
          subtitle="If you quote, agree terms with and bill your own clients, the workflow fits. Pick the kind of work you do; it works the same way."
        />

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5 mt-14"
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
            <span className="text-emerald-400 font-semibold">One workflow.</span>{" "}
            A fixed-fee project, an hourly engagement or a monthly retainer: the quote, the signed scope, the invoice and the payment tracking work the same way each time, in the currency you charge in.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

const FREE_TOOLS = [
  { name: "Quotation Maker", href: "/tools/quotation-maker", desc: "Professional quotations with line items, tax and terms.", icon: FileText },
  { name: "Service Agreement", href: "/tools/service-agreement-template", desc: "A ready-to-sign contract with scope, fees and editable clauses.", icon: FileSignature },
  { name: "Bill Generator", href: "/tools/bill-generator", desc: "Create a bill online in a minute — with a PAID stamp.", icon: ReceiptText },
  { name: "Proforma Invoice", href: "/tools/proforma-invoice-generator", desc: "Confirm price & terms before the sale.", icon: FileCheck },
  { name: "Purchase Order", href: "/tools/purchase-order-generator", desc: "Raise a clean PO for your vendor in a minute.", icon: ClipboardList },
  { name: "UK Late Payment Calculator", href: "/tools/uk-late-payment-calculator", desc: "Work out the statutory interest and compensation a late-paying UK client owes.", icon: Clock },
  { name: "GST Invoice Generator (India)", href: "/tools/gst-invoice-generator", desc: "Auto CGST/SGST/IGST, amount in words, instant PDF.", icon: Receipt },
  { name: "GST Calculator (India)", href: "/tools/gst-calculator", desc: "Add or remove GST with the CGST/SGST or IGST split.", icon: Calculator },
];

function FreeToolsSection() {
  return (
    <section id="free-tools" className="py-20 sm:py-28 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Free tools · No sign-up"
          title={
            <>
              Start with a free tool,{" "}
              <span style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                no account needed
              </span>
            </>
          }
          subtitle="Quotations, agreements and bills that work wherever you bill from, plus a few country-specific tools. Built in the browser, no sign-up. When you're ready to run whole deals, the app is one click away."
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

        {/* Discipline bridge: invoice-format guides for the freelance ICP (also
            internal links that help Google connect the landing to the SEO pages) */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-xs text-neutral-500">
          <span className="font-semibold uppercase tracking-wider text-[10px]">Invoice formats for your work:</span>
          {[
            { label: "Graphic designers", href: "/tools/invoice-format/for-graphic-designers" },
            { label: "Web developers", href: "/tools/invoice-format/for-web-developers" },
            { label: "Content writers", href: "/tools/invoice-format/for-content-writers" },
            { label: "Video editors", href: "/tools/invoice-format/for-video-editors" },
            { label: "Photographers", href: "/tools/invoice-format/for-photographers" },
            { label: "Social media managers", href: "/tools/invoice-format/for-social-media-managers" },
            { label: "Consultants", href: "/tools/invoice-format/for-consultants" },
            { label: "Freelancers", href: "/tools/invoice-format/for-freelancers" },
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

function PricingPreview({ onCTA }: { onCTA: () => void }) {
  const freePerks = [
    "4 deals every month",
    "A professional quotation with each deal",
    "Dashboard & payment overview",
    "Professional quotation PDFs",
  ];
  const proMonthlyPerks = [
    "Unlimited deals & quotations",
    "Unlimited agreements with your signature and signed-copy tracking",
    "Unlimited professional invoices",
    "Payment tracking: paid, pending and overdue",
    "Priority email support",
  ];
  const proAnnualPerks = [
    "Everything in Pro Monthly",
    "Unlimited workflow for a full year",
    "One payment — no monthly renewals",
    "₹999 for the year instead of ₹1,188",
  ];

  return (
    <section id="pricing" className="py-20 sm:py-28 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/20 scroll-mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Pricing"
          title="Start simple. Grow when you need to."
          subtitle="Try DealInSec free and manage your first client deals without adding another expensive tool to your stack."
        />

        {/* Honest currency note: only Indian accounts can be charged today. */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-10 max-w-3xl mx-auto rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-5 sm:p-6"
        >
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 mb-2.5">
            <Globe className="w-3.5 h-3.5" /> Pricing around the world
          </p>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
            New accounts start with a 7-day Pro trial, and the free plan stays free after it. Both are open everywhere, with no card. The prices below are in rupees and can be paid from India today. International plans will be
            <span className="font-semibold text-neutral-900 dark:text-white"> $99, £79 or €89 a year</span>, annual
            only. Checkout for them is opening soon, and we won&apos;t take a foreign card until it can be charged in your own currency.
          </p>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-8 max-w-6xl mx-auto"
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
            <p className="text-xs text-neutral-500 mt-1">Try DealInSec with your first real client work.</p>
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
            className="relative rounded-2xl border border-emerald-500 bg-white dark:bg-neutral-900 shadow-xl shadow-emerald-500/15 scale-[1.02] overflow-hidden"
          >
            {/* Promo bar */}
            <div
              className="px-4 py-2 text-center text-white text-[11px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5"
              style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
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
                    style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
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
                    background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  ₹99
                </span>
                <span className="text-sm text-neutral-500">/ month</span>
              </div>
              <p className="text-xs text-neutral-500 mt-1">Take the deal all the way to signed agreement, invoice and payment tracking.</p>

              <ul className="mt-5 space-y-2.5">
                {proMonthlyPerks.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                    <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Button
                onClick={onCTA}
                className="w-full mt-6 h-11 text-sm font-bold text-white border-0 shadow-md shadow-emerald-500/30"
                style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
                data-testid="button-go-pro-monthly"
              >
                Go Pro — ₹99/month
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
                  <Check className="w-2.5 h-2.5 text-emerald-500" /> India: UPI · Cards · NetBanking
                </span>
              </div>
            </div>
          </motion.div>

          {/* Pro Annual — ₹999/yr, i.e. ₹189 less than 12 × ₹99 */}
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
                Save ₹189
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-bold tracking-tight">₹999</span>
              <span className="text-sm text-neutral-500">/ year</span>
            </div>
            <p className="text-xs text-neutral-500 mt-1">≈ ₹83/month — ₹189 less than paying ₹99 twelve times.</p>
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
              className="w-full mt-6 h-11 text-sm font-bold text-white border-0 shadow-md shadow-emerald-900/20"
              style={{ background: "linear-gradient(135deg, #065F46 0%, #115E59 100%)" }}
              data-testid="button-go-pro"
            >
              Go Pro Annual — ₹999/year
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <p className="text-[11px] text-neutral-500 text-center mt-3">One payment, not auto-renewing. A full year of the Pro workflow.</p>
          </motion.div>
        </motion.div>

        {/* What's free vs. what needs Pro */}
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
              { step: "4", title: "Invoice & track payment", cost: "Pro", icon: Receipt, highlight: true },
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
          title="Questions freelancers ask"
          subtitle="Straight answers about what DealInSec does, and what it doesn't."
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
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white mb-4 text-balance">
              Ready to make your next deal easier?
            </h2>
            <p className="text-base sm:text-lg text-emerald-100/90 max-w-xl mx-auto mb-8">
              Create your quote, agreement and invoice in one connected workflow.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                onClick={onCTA}
                className="h-12 px-6 text-sm font-semibold bg-white text-emerald-700 hover:bg-neutral-100 border-0 shadow-xl"
                data-testid="button-final-cta"
              >
                {isAuthenticated ? "Go to Dashboard" : "Start for free"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <a
                href="#how"
                className="h-12 px-6 inline-flex items-center justify-center text-sm font-semibold rounded-md border border-white/30 text-white hover:bg-white/10 transition-colors"
              >
                See how it works
              </a>
            </div>
            <p className="text-xs text-emerald-100/70 mt-6">Built for freelancers worldwide.</p>
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
              Quotes, agreements, invoices and payment tracking for freelancers worldwide, in 50 currencies.
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
              { label: "Freelancer Invoice Software", href: "/freelancer-invoice-software" },
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
            { Icon: Check, text: "India: UPI · Cards · NetBanking" },
            { Icon: Zap, text: "Free plan and 7-day Pro trial, worldwide" },
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
