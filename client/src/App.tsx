import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import LandingPage from "@/pages/landing";
import OnboardingPage from "@/pages/onboarding";
import DashboardPage from "@/pages/dashboard";
import DealsPage from "@/pages/deals";
import CreateDealPage from "@/pages/create-deal";
import DealDetailsPage from "@/pages/deal-details";
import ContractConfirmationPage from "@/pages/contract-confirmation";
import ContractsPage from "@/pages/contracts";
import ContractDetailsPage from "@/pages/contract-details";
import ContractPdfPage from "@/pages/contract-pdf";
import BillingPage from "@/pages/billing";
import InvoiceDetailsPage from "@/pages/invoice-details";
import PaymentSuccessPage from "@/pages/payment-success";
import BrandInvoiceDetailsPage from "@/pages/brand-invoice-details";
import ProfilePage from "@/pages/profile";
import PricingPage from "@/pages/pricing";
import PitchPage from "@/pages/pitch";
import QuotePreviewPage from "@/pages/quote-preview";
import NotFound from "@/pages/not-found";

function Router() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const needsOnboarding = isAuthenticated && user && !user.onboardingComplete;

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/pitch" component={PitchPage} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  if (needsOnboarding) {
    return (
      <Switch>
        <Route path="/" component={OnboardingPage} />
        <Route path="/onboarding" component={OnboardingPage} />
        <Route component={OnboardingPage} />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/deals" component={DealsPage} />
      <Route path="/deals/new" component={CreateDealPage} />
      <Route path="/deals/:id" component={DealDetailsPage} />
      <Route path="/deals/:id/quote" component={QuotePreviewPage} />
      <Route path="/deals/:id/contract" component={ContractConfirmationPage} />
      <Route path="/contracts" component={ContractsPage} />
      <Route path="/contracts/:id" component={ContractDetailsPage} />
      <Route path="/contracts/:id/export" component={ContractPdfPage} />
      <Route path="/billing" component={BillingPage} />
      <Route path="/billing/success" component={PaymentSuccessPage} />
      <Route path="/billing/invoice/:id" component={InvoiceDetailsPage} />
      <Route path="/brand-invoices/:id" component={BrandInvoiceDetailsPage} />
      <Route path="/profile" component={ProfilePage} />
      <Route path="/pricing" component={PricingPage} />
      <Route component={NotFound} />
    </Switch>
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
