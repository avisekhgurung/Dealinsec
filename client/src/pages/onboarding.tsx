import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName.trim()) {
      toast({ title: "Full name is required", variant: "destructive" });
      return;
    }
    if (!/^[6-9]\d{9}$/.test(phone.replace(/\D/g, ""))) {
      toast({ title: "Enter a valid 10-digit Indian mobile number", variant: "destructive" });
      return;
    }
    if (!billingAddress.trim()) {
      toast({ title: "Billing address is required", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const nameParts = fullName.trim().split(" ");
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(" ") || null;

      await apiRequest("PATCH", "/api/profile", {
        firstName,
        lastName,
        phone: phone.replace(/\D/g, ""),
        billingAddress: billingAddress.trim(),
        onboardingComplete: true,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "You're in!", description: "We'll ask for PAN, bank & signature only when you need them." });
      setLocation("/dashboard");
    } catch (error: any) {
      toast({
        title: "Failed to save profile",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center px-4 py-8">
      <Card className="glass-card w-full max-w-md border-0 animate-fade-in">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome to Dealinsec</CardTitle>
          <CardDescription>
            Just 3 quick details to start. We'll ask for the rest right when you need them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name *</Label>
              <Input
                id="fullName"
                type="text"
                placeholder="Enter your full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                data-testid="input-fullname"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number *</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={10}
                required
                data-testid="input-phone"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="billingAddress">Billing Address *</Label>
              <Textarea
                id="billingAddress"
                placeholder="Street, city, state, PIN (appears on invoices)"
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                rows={3}
                data-testid="input-billing-address"
              />
            </div>

            <div className="rounded-xl bg-primary/5 border border-primary/15 p-3.5 flex gap-2.5">
              <Sparkles className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">PAN &amp; signature</span> are collected right before your first agreement.{" "}
                <span className="font-semibold text-foreground">Bank details</span> are collected right before your first invoice. No mid-flow surprises.
              </p>
            </div>

            <Button type="submit" className="gradient-btn w-full h-11" disabled={isLoading} data-testid="button-complete-profile">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
