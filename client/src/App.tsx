import { lazy, Suspense, useEffect , Component, type ReactNode} from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { AppLoader, RouteLoader } from "@/components/app-loader";
import { DesktopSidebar } from "@/components/desktop-sidebar";
import { InstallPrompt } from "@/components/install-prompt";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { UpgradeModalProvider } from "@/components/upgrade-modal";
import { Copilot } from "@/components/copilot/copilot";
import { trackPageView, trackEvent } from "@/lib/analytics";
import { useLocation } from "wouter";

// Eagerly loaded — always needed for first render
import LandingPage from "@/pages/landing";
import NotFound from "@/pages/not-found";

// Lazy-loaded — only fetched when the user navigates to that route
const OnboardingPage          = lazy(() => import("@/pages/onboarding"));
const DashboardPage           = lazy(() => import("@/pages/dashboard"));
const DealsPage               = lazy(() => import("@/pages/deals"));
const CreateDealPage          = lazy(() => import("@/pages/create-deal"));
const EditDealPage            = lazy(() => import("@/pages/edit-deal"));
const DealDetailsPage         = lazy(() => import("@/pages/deal-details"));
const QuotePreviewPage        = lazy(() => import("@/pages/quote-preview"));
const QuotationsPage          = lazy(() => import("@/pages/quotations"));
const ContractConfirmationPage = lazy(() => import("@/pages/contract-confirmation"));
const ContractsPage           = lazy(() => import("@/pages/contracts"));
const ContractDetailsPage     = lazy(() => import("@/pages/contract-details"));
const ContractPdfPage         = lazy(() => import("@/pages/contract-pdf"));
const BillingPage             = lazy(() => import("@/pages/billing"));
const InvoiceDetailsPage      = lazy(() => import("@/pages/invoice-details"));
const PaymentSuccessPage      = lazy(() => import("@/pages/payment-success"));
const BrandInvoiceDetailsPage = lazy(() => import("@/pages/brand-invoice-details"));
const BrandInvoiceNewPage     = lazy(() => import("@/pages/brand-invoice-new"));
const ProfilePage             = lazy(() => import("@/pages/profile"));
const PricingPage             = lazy(() => import("@/pages/pricing"));
const PitchPage               = lazy(() => import("@/pages/pitch"));
const TermsPage               = lazy(() => import("@/pages/legal/terms"));
const PrivacyPage             = lazy(() => import("@/pages/legal/privacy"));
const CookiePage              = lazy(() => import("@/pages/legal/cookies"));
const RefundPage              = lazy(() => import("@/pages/legal/refund"));
const SettingsPage            = lazy(() => import("@/pages/settings"));
const AcceptInvitePage        = lazy(() => import("@/pages/accept-invite"));
const DealsImportPage         = lazy(() => import("@/pages/deals-import"));
const AuthPage                = lazy(() => import("@/pages/auth"));
const ForgotPasswordPage      = lazy(() => import("@/pages/forgot-password"));
const ResetPasswordPage       = lazy(() => import("@/pages/reset-password"));

// Routes where the desktop sidebar + content offset should NOT apply
// (full-bleed marketing / auth / standalone routes).
const FULL_BLEED_ROUTES = new Set([
  "/",
  "/pitch",
  "/terms",
  "/privacy",
  "/cookies",
  "/refund",
  "/onboarding",
]);

function isFullBleedRoute(pathname: string) {
  if (FULL_BLEED_ROUTES.has(pathname)) return true;
  if (pathname.startsWith("/invite/")) return true;
  // Contract PDF print-friendly view also goes full-bleed
  if (pathname.match(/^\/contracts\/[^/]+\/export$/)) return true;
  return false;
}

function Router() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [location, setLocation] = useLocation();

  // Fire a GA4 page_view on every SPA route change (and on first render).
  // The gtag config in index.html has send_page_view:false, so this is the
  // single source of truth for page views.
  useEffect(() => {
    trackPageView(location);
  }, [location]);

  // Google OAuth signups redirect back with ?signup=google (email signups
  // fire sign_up client-side already). Fire the GA4 conversion once, then
  // strip the param so a refresh can't double-count.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("signup") === "google") {
      trackEvent("sign_up", { method: "google" });
      params.delete("signup");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, []);


  // Initial app load (auth check) → full branded splash, shown once per session
  if (isLoading) {
    return <AppLoader />;
  }

  const needsOnboarding = isAuthenticated && user && !user.onboardingComplete;

  // Landing page lives at "/" for everyone — logged-out visitors see marketing,
  // logged-in visitors see the same page with a Dashboard button in the header.
  // All authenticated app routes sit under /dashboard, /deals, /contracts, etc.
  if (!isAuthenticated) {
    return (
      <Suspense fallback={<RouteLoader />}>
        <Switch>
          <Route path="/" component={LandingPage} />
          <Route path="/auth" component={AuthPage} />
          <Route path="/forgot-password" component={ForgotPasswordPage} />
          <Route path="/reset-password" component={ResetPasswordPage} />
          {/* /pricing is intentionally NOT here — it's the in-app credit
              purchase page, secured to logged-in users only. Public pricing
              info lives in the LandingPage's #pricing section. */}
          <Route path="/pitch" component={PitchPage} />
          <Route path="/terms" component={TermsPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/cookies" component={CookiePage} />
          <Route path="/refund" component={RefundPage} />
          <Route path="/invite/:token" component={AcceptInvitePage} />
          {/* Any protected/unknown route while logged out (e.g. the PWA
              opening at its start_url /dashboard) → bounce to landing so the
              user can log in, instead of a dead 404. */}
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch>
      </Suspense>
    );
  }

  if (needsOnboarding) {
    return (
      <Suspense fallback={<RouteLoader />}>
        <Switch>
          <Route path="/onboarding" component={OnboardingPage} />
          <Route component={OnboardingPage} />
        </Switch>
      </Suspense>
    );
  }

  const showShell = !isFullBleedRoute(location);

  return (
    <>
      {showShell && <DesktopSidebar />}
      {/* Copilot floats on every authed workspace page (not on print/full-bleed views) */}
      {showShell && <Copilot />}
      {/* Content offset tracks the sidebar width via --dis-sidebar-w
          (see .app-shell in index.css) so the collapsible rail and the
          content stay in lockstep. */}
      <div className={showShell ? "app-shell" : ""}>
        <Suspense fallback={<RouteLoader />}>
          <Switch>
            {/* Authenticated users hitting `/` go straight to the dashboard
                — the marketing landing page is for logged-out visitors only. */}
            <Route path="/">
              <Redirect to="/dashboard" />
            </Route>
            <Route path="/auth"><Redirect to="/dashboard" /></Route>
            <Route path="/forgot-password"><Redirect to="/dashboard" /></Route>
            <Route path="/reset-password"><Redirect to="/dashboard" /></Route>
            <Route path="/dashboard" component={DashboardPage} />
            <Route path="/deals" component={DealsPage} />
            <Route path="/deals/new" component={CreateDealPage} />
            <Route path="/deals/import" component={DealsImportPage} />
            <Route path="/deals/:id/quote" component={QuotePreviewPage} />
            <Route path="/deals/:id/edit" component={EditDealPage} />
            <Route path="/deals/:id/contract" component={ContractConfirmationPage} />
            <Route path="/deals/:id" component={DealDetailsPage} />
            <Route path="/quotations" component={QuotationsPage} />
            <Route path="/contracts" component={ContractsPage} />
            <Route path="/contracts/:id/export" component={ContractPdfPage} />
            <Route path="/contracts/:id" component={ContractDetailsPage} />
            <Route path="/invoices/success" component={PaymentSuccessPage} />
            <Route path="/invoices/:id" component={InvoiceDetailsPage} />
            <Route path="/invoices" component={BillingPage} />
            <Route path="/brand-invoices/new" component={BrandInvoiceNewPage} />
            <Route path="/brand-invoices/:id" component={BrandInvoiceDetailsPage} />
            <Route path="/profile" component={ProfilePage} />
            <Route path="/settings" component={SettingsPage} />
            <Route path="/invite/:token" component={AcceptInvitePage} />
            <Route path="/pricing" component={PricingPage} />
            <Route path="/pitch" component={PitchPage} />
            <Route path="/terms" component={TermsPage} />
            <Route path="/privacy" component={PrivacyPage} />
            <Route path="/cookies" component={CookiePage} />
            <Route path="/refund" component={RefundPage} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </div>
    </>
  );
}


/** Last-resort net: an uncaught render error used to leave a white screen —
 *  fatal in a demo. Shows a reload card instead. Class component because
 *  error boundaries still cannot be hooks. */
class CrashGuard extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="text-center max-w-sm">
          <p className="text-3xl mb-3" aria-hidden="true">😵</p>
          <h1 className="font-semibold text-lg mb-1">Something went wrong</h1>
          <p className="text-sm text-muted-foreground mb-5">
            Your data is safe — this screen just crashed. Reload to continue.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-11 px-6 rounded-xl gradient-btn text-white font-semibold"
            data-testid="button-crash-reload"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

function App() {
  // Documents must print on white whatever theme the screen uses. Overriding
  // 128 CSS variables in @media print would drift; stripping the dark class
  // for the duration of the print flips the entire cascade to light at once.
  useEffect(() => {
    let wasDark = false;
    const before = () => {
      wasDark = document.documentElement.classList.contains("dark");
      if (wasDark) document.documentElement.classList.remove("dark");
    };
    const after = () => {
      if (wasDark) document.documentElement.classList.add("dark");
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConfirmProvider>
          <UpgradeModalProvider>
            <div className="min-h-screen bg-background text-foreground">
              <CrashGuard>
                <Router />
              </CrashGuard>
            </div>
            <InstallPrompt />
            <Toaster />
          </UpgradeModalProvider>
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
