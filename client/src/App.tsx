import { lazy, Suspense, useEffect } from "react";
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
import { trackPageView } from "@/lib/analytics";
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
const ProfilePage             = lazy(() => import("@/pages/profile"));
const PricingPage             = lazy(() => import("@/pages/pricing"));
const PitchPage               = lazy(() => import("@/pages/pitch"));
const TermsPage               = lazy(() => import("@/pages/legal/terms"));
const PrivacyPage             = lazy(() => import("@/pages/legal/privacy"));
const CookiePage              = lazy(() => import("@/pages/legal/cookies"));
const RefundPage              = lazy(() => import("@/pages/legal/refund"));
const SettingsPage            = lazy(() => import("@/pages/settings"));
const AcceptInvitePage        = lazy(() => import("@/pages/accept-invite"));
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConfirmProvider>
          <UpgradeModalProvider>
            <div className="min-h-screen bg-background text-foreground">
              <Router />
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
