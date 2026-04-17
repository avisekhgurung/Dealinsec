import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, ArrowLeft, Edit, LogOut, CreditCard, Copy, Share2, User, Mail, Phone, FileText, Building, MapPin, PenTool, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useLocation, Link } from "wouter";
import { BottomNav } from "@/components/bottom-nav";

export default function ProfilePage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: referralData } = useQuery<{ referralCode: string; referrals: any[]; totalCreditsEarned: number }>({
    queryKey: ["/api/referrals"],
  });
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [panNumber, setPanNumber] = useState(user?.panNumber || "");
  const [gstNumber, setGstNumber] = useState(user?.gstNumber || "");
  const [billingAddress, setBillingAddress] = useState((user as any)?.billingAddress || "");
  const [signaturePreview, setSignaturePreview] = useState<string | null>(user?.digitalSignature || null);
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

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    } catch (error) {
      toast({ title: "Failed to logout", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      let digitalSignaturePath = signaturePreview;

      if (signatureFile) {
        const formData = new FormData();
        formData.append("signature", signatureFile);
        const uploadRes = await fetch("/api/profile/signature", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!uploadRes.ok) throw new Error("Failed to upload signature");
        const uploadData = await uploadRes.json();
        digitalSignaturePath = uploadData.path;
      }

      await apiRequest("PATCH", "/api/profile", {
        firstName: firstName || null,
        lastName: lastName || null,
        phone: phone || null,
        panNumber: panNumber || null,
        gstNumber: gstNumber || null,
        billingAddress: billingAddress.trim() || null,
        digitalSignature: digitalSignaturePath,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Profile updated successfully!" });
      setIsEditing(false);
    } catch (error: any) {
      toast({
        title: "Failed to update profile",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Not set";
  const initials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join("").toUpperCase() || user?.email?.[0]?.toUpperCase() || "?";

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Gradient Banner Header */}
      <div className="relative">
        <div
          className="h-40"
          style={{
            background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.6) 50%, hsl(280 80% 50%) 100%)",
          }}
        />
        <div className="absolute top-0 left-0 right-0 px-4 pt-3 flex items-center justify-between z-10">
          <Link href="/">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex gap-2">
            {!isEditing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(true)}
                className="text-white hover:bg-white/20"
                data-testid="button-edit-profile"
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={handleLogout} data-testid="button-logout">
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Avatar + Identity */}
      <div className="flex flex-col items-center -mt-12 relative z-10">
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold text-white shadow-lg ring-4 ring-background"
          style={{
            background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(280 80% 50%) 100%)",
          }}
        >
          {initials}
        </div>
      </div>

      {/* Name + email below avatar */}
      <div className="text-center mt-3 mb-6 px-4">
        <h2 className="text-xl font-bold" data-testid="text-fullname">{fullName}</h2>
        <p className="text-sm text-muted-foreground" data-testid="text-email">{user?.email || "No email"}</p>
      </div>

      <main className="px-4 space-y-4 max-w-lg mx-auto animate-fade-in">
        {isEditing ? (
          /* ---- Edit Mode ---- */
          <div className="glass-card rounded-2xl p-5 space-y-5" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.5)" }}>
            <div className="flex items-center gap-2 mb-1">
              <Edit className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-lg">Edit Profile</h3>
            </div>
            <p className="text-sm text-muted-foreground -mt-3">Update your profile information</p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  data-testid="input-firstname"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  data-testid="input-lastname"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Enter phone number"
                data-testid="input-phone"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="panNumber">PAN Number</Label>
              <Input
                id="panNumber"
                value={panNumber}
                onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                placeholder="ABCDE1234F"
                maxLength={10}
                data-testid="input-pan"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gstNumber">GST Number</Label>
              <Input
                id="gstNumber"
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                placeholder="22AAAAA0000A1Z5"
                maxLength={15}
                data-testid="input-gst"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="billingAddress">Billing Address</Label>
              <Textarea
                id="billingAddress"
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                placeholder="Full address for invoices (street, city, state, PIN)"
                rows={3}
                data-testid="input-billing-address"
              />
            </div>

            <div className="space-y-2">
              <Label>Digital Signature</Label>
              <div className="border-2 border-dashed border-white/20 rounded-xl p-4">
                {signaturePreview ? (
                  <div className="space-y-2">
                    <img
                      src={signaturePreview}
                      alt="Signature"
                      className="max-h-24 mx-auto"
                      data-testid="img-signature"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full glass-card"
                      onClick={() => {
                        setSignaturePreview(null);
                        setSignatureFile(null);
                      }}
                      data-testid="button-remove-signature"
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="text-center">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      className="glass-card"
                      data-testid="button-upload-signature"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Signature
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setIsEditing(false)}
                disabled={isLoading}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                className="flex-1 gradient-btn text-white"
                onClick={handleSave}
                disabled={isLoading}
                data-testid="button-save-profile"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
              </Button>
            </div>
          </div>
        ) : (
          /* ---- View Mode: Card Grid ---- */
          <div className="space-y-4">
            {/* Personal Info Card */}
            <div className="glass-card rounded-2xl p-5 border-0" style={{ background: "linear-gradient(135deg, hsl(var(--card)) 0%, hsl(var(--card) / 0.8) 100%)" }}>
              <div className="flex items-center gap-2 mb-4">
                <User className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Personal Info</h3>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Full Name</p>
                    <p className="font-medium truncate">{fullName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Mail className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="font-medium truncate">{user?.email || "Not set"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Phone className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="font-medium" data-testid="text-phone">{user?.phone || "Not set"}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Business Info Card */}
            <div className="glass-card rounded-2xl p-5 border-0" style={{ background: "linear-gradient(135deg, hsl(var(--card)) 0%, hsl(var(--card) / 0.8) 100%)" }}>
              <div className="flex items-center gap-2 mb-4">
                <Building className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Business Info</h3>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">PAN Number</p>
                    <p className="font-medium" data-testid="text-pan">{user?.panNumber || "Not set"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">GST Number</p>
                    <p className="font-medium" data-testid="text-gst">{user?.gstNumber || "Not set"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <MapPin className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Billing Address</p>
                    <p className="font-medium whitespace-pre-wrap" data-testid="text-billing-address">
                      {(user as any)?.billingAddress || "Not provided"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Signature Card */}
            {user?.digitalSignature && (
              <div className="glass-card rounded-2xl p-5 border-0" style={{ background: "linear-gradient(135deg, hsl(var(--card)) 0%, hsl(var(--card) / 0.8) 100%)" }}>
                <div className="flex items-center gap-2 mb-4">
                  <PenTool className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">Digital Signature</h3>
                </div>
                <div className="rounded-xl bg-white p-4 flex items-center justify-center">
                  <img
                    src={user.digitalSignature}
                    alt="Signature"
                    className="h-24 w-auto object-contain block"
                    style={{ maxWidth: "100%", display: "block", visibility: "visible" }}
                    data-testid="img-signature-view"
                  />
                </div>
              </div>
            )}

            {/* Credits Card */}
            <div
              className="rounded-2xl p-5 border-0 relative overflow-hidden"
              style={{
                background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(280 80% 50%) 100%)",
              }}
            >
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-white/10 -mr-10 -mt-10" />
              <div className="absolute bottom-0 left-0 w-20 h-20 rounded-full bg-white/5 -ml-6 -mb-6" />
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="h-4 w-4 text-white/80" />
                  <h3 className="font-semibold text-white/90">Contract Credits</h3>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-4xl font-bold text-white" data-testid="text-credits">
                      {user?.contractCredits ?? 0}
                    </p>
                    <p className="text-sm text-white/60 mt-1">Available credits</p>
                  </div>
                  <Link href="/pricing">
                    <Button
                      size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-sm"
                      data-testid="button-buy-credits"
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      Buy Credits
                    </Button>
                  </Link>
                </div>
              </div>
            </div>

            {/* Referral Card */}
            <div className="glass-card rounded-2xl p-5 border-0" style={{ background: "linear-gradient(135deg, hsl(var(--card)) 0%, hsl(var(--card) / 0.8) 100%)" }}>
              <div className="flex items-center gap-2 mb-2">
                <Share2 className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Referral Program</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Share your referral code with friends. You get a free credit for every friend who signs up!
              </p>

              {referralData?.referralCode && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-muted rounded-lg px-4 py-3 font-mono text-lg font-bold tracking-wider text-center">
                      {referralData.referralCode}
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        navigator.clipboard.writeText(referralData.referralCode);
                        toast({ title: "Copied!", description: "Referral code copied to clipboard" });
                      }}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/?ref=${referralData.referralCode}`);
                        toast({ title: "Link copied!", description: "Referral link copied to clipboard" });
                      }}
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      Copy Link
                    </Button>
                    <Button
                      className="flex-1 text-xs gradient-btn text-white"
                      onClick={() => {
                        const url = `${window.location.origin}/?ref=${referralData.referralCode}`;
                        const text = `Join InfluDeal and manage your brand deals like a pro! Sign up using my referral link and we both get free credits 🎉`;
                        if (navigator.share) {
                          navigator.share({ title: "Join InfluDeal", text, url }).catch(() => {});
                        } else {
                          navigator.clipboard.writeText(`${text}\n${url}`);
                          toast({ title: "Copied!", description: "Share text copied to clipboard" });
                        }
                      }}
                    >
                      <Share2 className="w-3 h-3 mr-1" />
                      Share
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/10">
                    <div className="text-center rounded-xl bg-primary/10 py-3">
                      <p className="text-2xl font-bold text-primary">{referralData.referrals?.length || 0}</p>
                      <p className="text-xs text-muted-foreground">Referrals</p>
                    </div>
                    <div className="text-center rounded-xl bg-emerald-500/10 py-3">
                      <p className="text-2xl font-bold text-emerald-500">{referralData.totalCreditsEarned || 0}</p>
                      <p className="text-xs text-muted-foreground">Credits Earned</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
