import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { AppLoader, RouteLoader } from "@/components/app-loader";

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

function Router() {
  const { isAuthenticated, isLoading, user } = useAuth();

  // Initial app load (auth check) → full branded splash, shown once per session
  if (isLoading) {
    return <AppLoader />;
  }

  const needsOnboarding = isAuthenticated && user && !user.onboardingComplete;

  // Route transitions → thin gradient progress bar, non-blocking
  if (!isAuthenticated) {
    return (
      <Suspense fallback={<RouteLoader />}>
        <Switch>
          <Route path="/" component={LandingPage} />
          <Route path="/pitch" component={PitchPage} />
          <Route path="/terms" component={TermsPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/cookies" component={CookiePage} />
          <Route path="/refund" component={RefundPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    );
  }

  if (needsOnboarding) {
    return (
      <Suspense fallback={<RouteLoader />}>
        <Switch>
          <Route path="/" component={OnboardingPage} />
          <Route path="/onboarding" component={OnboardingPage} />
          <Route component={OnboardingPage} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<RouteLoader />}>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/deals" component={DealsPage} />
        <Route path="/deals/new" component={CreateDealPage} />
        <Route path="/deals/:id/quote" component={QuotePreviewPage} />
        <Route path="/deals/:id/edit" component={EditDealPage} />
        <Route path="/deals/:id/contract" component={ContractConfirmationPage} />
        <Route path="/deals/:id" component={DealDetailsPage} />
        <Route path="/contracts" component={ContractsPage} />
        <Route path="/contracts/:id/export" component={ContractPdfPage} />
        <Route path="/contracts/:id" component={ContractDetailsPage} />
        <Route path="/invoices/success" component={PaymentSuccessPage} />
        <Route path="/invoices/:id" component={InvoiceDetailsPage} />
        <Route path="/invoices" component={BillingPage} />
        <Route path="/brand-invoices/:id" component={BrandInvoiceDetailsPage} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/pricing" component={PricingPage} />
        <Route path="/terms" component={TermsPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/cookies" component={CookiePage} />
        <Route path="/refund" component={RefundPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen bg-background text-foreground">
          <Router />
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
