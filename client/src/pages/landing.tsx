import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, FileText, CreditCard, CheckCircle } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-12 pt-8">
          <h1 className="text-4xl font-bold mb-4" data-testid="text-app-title">InfluDeal</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto" data-testid="text-app-description">
            Professionally manage your brand deals, contracts, and billing - all in one place
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <Card>
            <CardHeader className="pb-3">
              <Briefcase className="h-8 w-8 text-primary mb-2" />
              <CardTitle className="text-lg">Track Deals</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Manage all your brand partnerships with detailed deliverables tracking
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <FileText className="h-8 w-8 text-primary mb-2" />
              <CardTitle className="text-lg">Sign Contracts</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Create exclusive contracts with proof uploads and professional documentation
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CreditCard className="h-8 w-8 text-primary mb-2" />
              <CardTitle className="text-lg">Handle Billing</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Auto-generated invoices with transparent platform fees
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CheckCircle className="h-8 w-8 text-primary mb-2" />
              <CardTitle className="text-lg">Stay Organized</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Mobile-first experience designed for influencers on the go
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        <div className="text-center">
          <Card className="max-w-md mx-auto">
            <CardHeader>
              <CardTitle>Get Started</CardTitle>
              <CardDescription>
                Sign in to manage your influencer business professionally
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a href="/api/login">
                <Button size="lg" className="w-full" data-testid="button-login">
                  Sign In
                </Button>
              </a>
            </CardContent>
          </Card>
        </div>

        <footer className="text-center mt-12 text-sm text-muted-foreground">
          <p>Platform Fee: 499 + 500 per contract</p>
        </footer>
      </div>
    </div>
  );
}
