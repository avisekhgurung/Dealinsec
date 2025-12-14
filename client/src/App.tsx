import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import LandingPage from "@/pages/landing";
import DashboardPage from "@/pages/dashboard";
import DealsPage from "@/pages/deals";
import CreateDealPage from "@/pages/create-deal";
import DealDetailsPage from "@/pages/deal-details";
import ContractConfirmationPage from "@/pages/contract-confirmation";
import ContractsPage from "@/pages/contracts";
import ContractDetailsPage from "@/pages/contract-details";
import BillingPage from "@/pages/billing";
import InvoiceDetailsPage from "@/pages/invoice-details";
import PaymentSuccessPage from "@/pages/payment-success";
import BrandDashboardPage from "@/pages/brand-dashboard";
import BrandDealsPage from "@/pages/brand-deals";
import BrandContractsPage from "@/pages/brand-contracts";
import BrandInvoiceDetailsPage from "@/pages/brand-invoice-details";
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

  const isBrand = user?.role === "brand";

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  if (isBrand) {
    return (
      <Switch>
        <Route path="/" component={BrandDashboardPage} />
        <Route path="/brand/deals" component={BrandDealsPage} />
        <Route path="/brand/deals/:id" component={DealDetailsPage} />
        <Route path="/brand/contracts" component={BrandContractsPage} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/deals" component={DealsPage} />
      <Route path="/deals/new" component={CreateDealPage} />
      <Route path="/deals/:id" component={DealDetailsPage} />
      <Route path="/deals/:id/contract" component={ContractConfirmationPage} />
      <Route path="/contracts" component={ContractsPage} />
      <Route path="/contracts/:id" component={ContractDetailsPage} />
      <Route path="/billing" component={BillingPage} />
      <Route path="/billing/success" component={PaymentSuccessPage} />
      <Route path="/billing/invoice/:id" component={InvoiceDetailsPage} />
      <Route path="/brand-invoices/:id" component={BrandInvoiceDetailsPage} />
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
