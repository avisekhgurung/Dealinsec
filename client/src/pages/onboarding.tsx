import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [panNumber, setPanNumber] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid File",
          description: "Please upload an image file (JPG, PNG, etc.)",
          variant: "destructive",
        });
        return;
      }
      setSignatureFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        setSignaturePreview(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName.trim()) {
      toast({ title: "Full name is required", variant: "destructive" });
      return;
    }

    if (!phone.trim()) {
      toast({ title: "Phone number is required", variant: "destructive" });
      return;
    }

    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone.replace(/\D/g, ""))) {
      toast({ title: "Invalid phone number", description: "Enter a valid 10-digit Indian mobile number", variant: "destructive" });
      return;
    }

    if (!panNumber.trim()) {
      toast({ title: "PAN number is required", variant: "destructive" });
      return;
    }

    if (panNumber.trim()) {
      const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
      if (!panRegex.test(panNumber.toUpperCase())) {
        toast({ title: "Invalid PAN format", description: "Format: ABCDE1234F", variant: "destructive" });
        return;
      }
    }

    if (!billingAddress.trim()) {
      toast({ title: "Billing address is required", variant: "destructive" });
      return;
    }

    if (!signatureFile && !signaturePreview) {
      toast({ title: "Digital signature is required", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const nameParts = fullName.trim().split(" ");
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(" ") || null;

      let digitalSignaturePath = signaturePreview;

      if (signatureFile) {
        const formData = new FormData();
        formData.append("signature", signatureFile);
        const uploadRes = await fetch("/api/profile/signature", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) throw new Error("Failed to upload signature");
        const uploadData = await uploadRes.json();
        digitalSignaturePath = uploadData.path;
      }

      await apiRequest("PATCH", "/api/profile", {
        firstName,
        lastName,
        phone: phone.replace(/\D/g, ""),
        panNumber: panNumber.trim() ? panNumber.toUpperCase() : null,
        gstNumber: gstNumber.trim() || null,
        billingAddress: billingAddress.trim() || null,
        digitalSignature: digitalSignaturePath,
        onboardingComplete: true,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Profile completed successfully!" });
      setLocation("/");
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
          <CardTitle className="text-2xl">Complete Your Profile</CardTitle>
          <CardDescription>
            Please fill in the required information to start using InfluDeal
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
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
              <Label htmlFor="panNumber">PAN Number *</Label>
              <Input
                id="panNumber"
                type="text"
                placeholder="ABCDE1234F"
                value={panNumber}
                onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                maxLength={10}
                required
                data-testid="input-pan"
              />
              <p className="text-xs text-muted-foreground">Required for invoicing</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="gstNumber">GST Number (Optional)</Label>
              <Input
                id="gstNumber"
                type="text"
                placeholder="22AAAAA0000A1Z5"
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                maxLength={15}
                data-testid="input-gst"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="billingAddress">Billing Address *</Label>
              <Textarea
                id="billingAddress"
                placeholder="Full address for invoices (street, city, state, PIN)"
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                rows={3}
                data-testid="input-billing-address"
              />
            </div>

            <div className="space-y-2">
              <Label>Digital Signature *</Label>
              <div className="border-2 border-dashed border-white/20 rounded-md p-4">
                {signaturePreview ? (
                  <div className="space-y-2">
                    <img
                      src={signaturePreview}
                      alt="Signature preview"
                      className="max-h-24 mx-auto"
                      data-testid="img-signature-preview"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setSignaturePreview(null);
                        setSignatureFile(null);
                      }}
                      data-testid="button-remove-signature"
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <div className="text-center space-y-2">
                    <div className="flex justify-center gap-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        data-testid="button-upload-signature"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Upload Image
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Upload a clear image of your signature (PNG, JPG)
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                      data-testid="input-signature-file"
                    />
                  </div>
                )}
              </div>
            </div>

            <Button type="submit" className="gradient-btn w-full" disabled={isLoading} data-testid="button-complete-profile">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Complete Profile"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
