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
  ChevronDown,
  Briefcase,
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
  ShieldCheck,
  Radar,
  Navigation,
  MessageSquare,
  Search,
  Target,
  Wallet,
  Bot,
  TrendingUp,
} from "lucide-react";
import { SiGoogle, SiInstagram, SiYoutube, SiX, SiFacebook, SiLinkedin } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { trackEvent } from "@/lib/analytics";
import { PRICING } from "@shared/product-facts";
import { OUTBOUND_ALLOWANCE_DEFAULTS, OUTBOUND_WINDOW_DAYS } from "@shared/outbound-plans";
import { PRO_INCLUDED_SEATS } from "@shared/permissions";
import { openConsentSettings } from "@/lib/consent";
import { LandingCopilot } from "@/components/landing-copilot";
import { DealinsecLogo } from "@/components/dealinsec-logo";
import { BRAND_GRADIENT, GradientText, SectionHeader, fadeUp, onSectionLinkClick, scrollToSection, stagger } from "@/components/landing-shared";
import { LandingTryDemo } from "@/components/landing-try-demo";
import { AiTeamSection, AudienceCards, CtaBanner, FaqSection, FeaturesSection, HeroSection, ManualWorkflowSection, WorkflowWalkthrough } from "@/components/landing-redesign";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LANDING_FAQS } from "@shared/landing-faqs";
import { rememberAudienceIntent } from "@/lib/audience-intent";
import type { Audience } from "@shared/audience";

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
  "/for-freelancers",
  "/for-creators",
  // Pages the landing page did not link to before, listed so a future link is
  // a plain navigation rather than a click wouter silently swallows.
  "/about",
  "/freelance-business-management-software",
  "/bonsai-alternatives",
  "/bonsai-vs-dealinsec",
  "/find-local-clients",
  "/ai-coworkers",
  "/crm-for-freelancers",
];
const isServerRoute = (href: string) => SERVER_ROUTE_PREFIXES.some((p) => href.startsWith(p));

/** The homepage nav: two menus and two links (signed out). Hash links stay on this page; server pages are real links. */
type NavLink = { label: string; href: string; note?: string };
const NAV_LINKS: (NavLink | { label: string; items: NavLink[] })[] = [
  { label: "Product", items: [
    { label: "How it works", href: "#how", note: "From a potential client to a paid invoice" },
    { label: "Features", href: "#features", note: "Leads, deals, quotations, agreements, invoices" },
    { label: "Live demo", href: "#try", note: "Plan a search, read a reply, see what's next" },
    { label: "Who it's for", href: "#audiences", note: "Freelancers, consultants and small agencies" },
  ] },
  { label: "AI team", href: "#ai-team" },
  { label: "Pricing", href: "#pricing" },
  { label: "Resources", items: [
    { label: "Blog", href: "/blog" },
    { label: "Free tools", href: "/tools" },
    { label: "Deal risk checker", href: "/tools/deal-risk-checker" },
    { label: "CRM for freelancers", href: "/crm-for-freelancers" },
    { label: "For freelancers", href: "/for-freelancers" },
    { label: "For creators", href: "/for-creators" },
    { label: "FAQ", href: "#faq" },
  ] },
];
const flatNav = (links: typeof NAV_LINKS): NavLink[] => links.flatMap((l) => ("items" in l ? l.items : [l]));

const DASHBOARD_LINKS = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
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
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") !== "google_auth_failed") return;
    toast({ title: "Google sign-in didn't finish", description: "Nothing was created. Try again, or sign up with your email.", variant: "destructive" });
    params.delete("error");
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  }, [toast]);

  // Arriving at /#pricing (or any section) from another page: the SPA renders after the browser's own jump, so go
  // there once the sections exist.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    const t = window.setTimeout(() => scrollToSection(hash), 150);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The auth experience is a dedicated page now (professional split-screen
  // + forgot-password flow) — the popup stays only as dead markup until a
  // future cleanup pass.
  // Which call to action a visitor used (the hero has its own event, hero_cta_click). A fixed location id only.
  const landingCta = (location: "pricing" | "final_banner" | "ask_dealinsec") => trackEvent("landing_cta_click", { location, signed_in: isAuthenticated });
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
    <div className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 relative overflow-x-clip antialiased">
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
        <HeroSection isAuthenticated={isAuthenticated} onPrimary={() => (isAuthenticated ? setLocation("/dashboard") : openAuth("signup"))} />
        <WorkflowWalkthrough />
        <AiTeamSection />
        <FeaturesSection />
        <ManualWorkflowSection />
        <AudienceCards />
        {!isAuthenticated && <LandingTryDemo />}
        <PricingPreview onCTA={() => { landingCta("pricing"); isAuthenticated ? setLocation("/pricing") : openAuth("signup"); }} />
        <CtaBanner isAuthenticated={isAuthenticated} onPrimary={() => { landingCta("final_banner"); isAuthenticated ? setLocation("/dashboard") : openAuth("signup"); }} />
        <FaqSection />
      </main>

      <Footer />

      {/* Public product guide — answers from the same knowledge base the
          in-app Copilot uses, so marketing can't drift from the product. */}
      <LandingCopilot onCta={() => { landingCta("ask_dealinsec"); isAuthenticated ? setLocation("/dashboard") : openAuth("signup"); }} />

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
                {authTab === "signup" ? "Start on the free plan. No card needed." : "Sign in to continue"}
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
          {/* Logo: compact header, no slogan */}
          <DealinsecLogo size="md" withText asLink />

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1" aria-label="Main">
            {isAuthenticated
              ? DASHBOARD_LINKS.map((link) => <NavItem key={link.label} href={link.href} label={link.label} />)
              : NAV_LINKS.map((link) => ("items" in link ? <NavMenu key={link.label} label={link.label} items={link.items} /> : <NavItem key={link.label} href={link.href} label={link.label} />))}
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
                    Go to Home
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
                  Log in
                </Button>
                <Button
                  onClick={() => { trackEvent("landing_cta_click", { location: "header", signed_in: false }); onAuthClick("signup"); }}
                  className="h-9 px-4 text-sm font-semibold text-white border-0 shadow-sm shadow-emerald-500/20"
                  style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
                  data-testid="button-nav-signup"
                >
                  <span>Get started<span className="hidden sm:inline"> free</span></span>
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
              {(isAuthenticated ? DASHBOARD_LINKS : flatNav(NAV_LINKS)).map((link: any) => {
                const Icon = link.icon;
                return (
                  <a
                    key={link.label}
                    href={link.href}
                    onClick={(e) => { onSectionLinkClick(e, 280); setMobileMenuOpen(false); }}
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
                    Log in
                  </Button>
                  <Button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onAuthClick("signup");
                    }}
                    className="w-full h-10 text-white border-0"
                    style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
                  >
                    Get started free
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
        onClick={(e) => onSectionLinkClick(e)}
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

/** A header menu (Product, Resources): keyboard-operable (Radix), hash and server links as real anchors. */
function NavMenu({ label, items }: { label: string; items: NavLink[] }) {
  // Controlled: an in-page item cancels the browser's jump (to scroll smoothly instead), which also skips the
  // menu's own close-on-select, so the click closes it here.
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-neutral-600 outline-none transition-colors hover:bg-neutral-100/70 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-emerald-500/50 data-[state=open]:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/50 dark:hover:text-white">
        {label}<ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-64 rounded-xl p-1.5" onCloseAutoFocus={(e) => e.preventDefault()}>
        {items.map((i) => (
          <DropdownMenuItem key={i.href} asChild className="cursor-pointer rounded-lg px-3 py-2">
            <a href={i.href} onClick={(e) => { onSectionLinkClick(e, 30); setOpen(false); }} className="flex flex-col items-start">
              <span className="text-sm font-medium">{i.label}</span>
              {i.note && <span className="text-xs text-neutral-500">{i.note}</span>}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PricingPreview({ onCTA }: { onCTA: () => void }) {
  const free = OUTBOUND_ALLOWANCE_DEFAULTS.free, pro = OUTBOUND_ALLOWANCE_DEFAULTS.pro;
  const freePerks = [
    `${PRICING.freeMonthlyDeals} new deals a month, each with its quotation`,
    "Lead pipeline: save researched prospects as leads, with follow-ups",
    `AI prospect research: ${free.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days, up to ${free.maxCompanies} companies each`,
    "Outreach drafts you approve, and the dashboard",
  ];
  const proMonthlyPerks = [
    "Unlimited deals & quotations",
    "Agreements your client signs online",
    "Invoices and payment tracking",
    `AI prospect research: ${pro.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days, up to ${pro.maxCompanies} companies each`,
    `Up to ${PRO_INCLUDED_SEATS} team members`,
    "One plan: no separate CRM or AI fee",
  ];

  return (
    <section id="pricing" className="py-20 sm:py-28 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/20 scroll-mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Pricing"
          title="Start free. Upgrade when you need more."
          subtitle="Manage leads, deals and quotations for free. Upgrade when you need agreements, invoices, payment tracking and more AI research."
        />

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-8 max-w-4xl mx-auto"
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
            <p className="text-xs text-neutral-500 mt-1">Research a prospect, save the lead, create the deal and send the quotation.</p>
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
              Get started free
            </Button>
            <p className="text-[11px] text-neutral-500 text-center mt-3">Free forever, no credit card required. Upgrade to Pro any time.</p>
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
                  <p className="text-sm font-semibold">DealInSec Pro</p>
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
                  ₹{PRICING.proMonthlyInr}
                </span>
                <span className="text-sm text-neutral-500">/ month</span>
              </div>
              <p className="text-xs text-neutral-500 mt-1">₹{PRICING.proMonthlyInr} is charged at checkout, with no tax added on top. Paid monthly in India; it doesn&apos;t renew or charge automatically — pay again to extend.</p>

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
                Go Pro — ₹{PRICING.proMonthlyInr}/month
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

        </motion.div>

        {/* Honest currency note: only Indian workspaces can buy Pro today. */}
        <p className="mt-6 max-w-3xl mx-auto flex items-start justify-center gap-2 text-center text-sm text-neutral-600 dark:text-neutral-400" data-testid="pricing-country-note">
          <Globe className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <span>Pro is paid in rupees by workspaces in India. The free plan works in every country; paid plans can&apos;t be bought outside India yet.</span>
        </p>

        {/* How the AI research limits work: read from shared/outbound-plans.ts and the run limits the server enforces. */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-10 max-w-4xl mx-auto rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-5 sm:p-6"
          data-testid="pricing-limits"
        >
          <p className="text-sm font-bold">How AI search limits work</p>
          <ul className="mt-3 grid gap-x-6 gap-y-2 text-sm text-neutral-600 dark:text-neutral-400 sm:grid-cols-2">
            {[
              `One credit is one search that ran on the web. A search that stopped before searching isn't counted.`,
              `Counted over a rolling ${OUTBOUND_WINDOW_DAYS} days, with at most 5 searches a day.`,
              `At the limit on Free, upgrade to Pro or wait; on Pro, searches free up as earlier ones pass ${OUTBOUND_WINDOW_DAYS} days.`,
              "Nothing is unlimited, and what you already found stays in your workspace.",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" /><span>{t}</span></li>
            ))}
          </ul>
        </motion.div>
      </div>
    </section>
  );
}

/** The slim footer: the logo with its slogan, the main links, socials; then a quieter row of every page worth finding. */
function Footer() {
  const main = [
    { label: "Product", href: "#features" }, { label: "AI team", href: "#ai-team" }, { label: "Pricing", href: "#pricing" }, { label: "Blog", href: "/blog" },
    { label: "Support", href: "mailto:support@dealinsec.com" }, { label: "Privacy", href: "/privacy" }, { label: "Terms", href: "/terms" },
  ];
  const more = [
    { label: "CRM for freelancers", href: "/crm-for-freelancers" }, { label: "For freelancers", href: "/for-freelancers" }, { label: "For creators", href: "/for-creators" }, { label: "Free tools", href: "/tools" },
    { label: "Deal risk checker", href: "/tools/deal-risk-checker" }, { label: "Freelancer invoice software", href: "/freelancer-invoice-software" },
    { label: "Quotation software", href: "/quotation-software" }, { label: "Contract management", href: "/contract-management" },
    { label: "Proposal management", href: "/proposal-management" }, { label: "Invoice management", href: "/invoice-management" },
    { label: "E-signature", href: "/e-signature" }, { label: "Pitch", href: "/pitch" }, { label: "Refund policy", href: "/refund" }, { label: "Cookies", href: "/cookies" },
  ];
  const link = (l: { label: string; href: string }, cls: string) =>
    l.href.startsWith("#") || l.href.startsWith("mailto:") || isServerRoute(l.href)
      ? <a key={l.label} href={l.href} onClick={(e) => onSectionLinkClick(e)} className={cls}>{l.label}</a>
      : <Link key={l.label} href={l.href} className={cls}>{l.label}</Link>;
  return (
    <footer className="relative z-[1] border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-6 md:flex-row md:justify-between">
          <DealinsecLogo size="md" withText tagline asLink />
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-neutral-600 dark:text-neutral-400">
            {main.map((l) => link(l, "transition-colors hover:text-emerald-700 dark:hover:text-emerald-300"))}
          </nav>
          <div className="flex items-center gap-2">
            {[
              { Icon: SiX, href: "https://x.com/dealinsec", label: "X" },
              { Icon: SiLinkedin, href: "https://www.linkedin.com/company/dealinsec", label: "LinkedIn" },
              { Icon: SiInstagram, href: "https://www.instagram.com/dealinsec", label: "Instagram" },
            ].map(({ Icon, href, label }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-500/10">
                <Icon className="h-3.5 w-3.5" />
              </a>
            ))}
          </div>
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-x-4 gap-y-1.5 border-t border-neutral-100 pt-6 text-[12px] text-neutral-500 dark:border-neutral-800">
          {more.map((l) => link(l, "hover:text-emerald-700 dark:hover:text-emerald-300"))}
          <button type="button" onClick={openConsentSettings} className="hover:text-emerald-700 dark:hover:text-emerald-300">Cookie settings</button>
        </div>
        <p className="mt-4 text-center text-[12px] text-neutral-400">© {new Date().getFullYear()} DealInSec. All rights reserved. Pro purchases are processed by Razorpay; DealInSec tracks your client payments and never handles them.</p>
      </div>
    </footer>
  );
}

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
