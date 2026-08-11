import { useState, useRef, useEffect, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, ArrowLeft, Edit, LogOut, CreditCard, Copy, Share2, User, Mail, Phone, FileText, Building, MapPin, PenTool, Sparkles, Landmark, Hash, Camera, Crown, Check, Stamp, Settings as SettingsIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useLocation, Link } from "wouter";
import { BottomNav } from "@/components/bottom-nav";
import { hasActivePro, hasActiveTrial, hasLapsedTrial, getTrialDaysLeft } from "@shared/schema";

// ─── Account-setup stepper ───────────────────────────────────────────────────
// Clickable progress: each step jumps STRAIGHT into edit mode at its section.
// This is the "travel anywhere" navigation — no hunting for an Edit button.
function SetupStepper({ steps, onStepClick }: {
  steps: { key: string; label: string; icon: any; done: boolean }[];
  onStepClick: (key: string) => void;
}) {
  const doneCount = steps.filter((s) => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);
  return (
    <div className="glass-card rounded-2xl border-0 p-4 lg:p-5" data-testid="profile-stepper">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm lg:text-base font-semibold">Account setup</h3>
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          {doneCount}/{steps.length} complete
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden mb-4">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-start gap-1 lg:gap-2">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <Fragment key={step.key}>
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={`flex-1 h-0.5 rounded-full mt-[18px] ${
                    steps[i - 1].done && step.done
                      ? "bg-emerald-500"
                      : steps[i - 1].done
                        ? "bg-emerald-500/40"
                        : "bg-border"
                  }`}
                />
              )}
              <button
                type="button"
                onClick={() => onStepClick(step.key)}
                className="group flex flex-col items-center gap-1.5 w-[72px] lg:w-24 shrink-0 rounded-lg focus-visible:outline-primary"
                aria-label={`${step.label}${step.done ? " — complete, click to edit" : " — click to add"}`}
                data-testid={`stepper-${step.key}`}
              >
                <span
                  className={`flex items-center justify-center w-9 h-9 rounded-full border-2 transition-all duration-150 group-hover:scale-105 ${
                    step.done
                      ? "bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                      : "border-border bg-background text-muted-foreground group-hover:border-primary group-hover:text-primary"
                  }`}
                >
                  {step.done ? <Check className="w-4 h-4" strokeWidth={3} /> : <Icon className="w-4 h-4" />}
                </span>
                <span
                  className={`text-[10px] lg:text-[11px] font-semibold text-center leading-tight w-full ${
                    step.done
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-muted-foreground group-hover:text-foreground"
                  }`}
                >
                  {step.label}
                </span>
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [panNumber, setPanNumber] = useState(user?.panNumber || "");
  const [gstNumber, setGstNumber] = useState(user?.gstNumber || "");
  const [billingAddress, setBillingAddress] = useState((user as any)?.billingAddress || "");
  const [accountHolderName, setAccountHolderName] = useState((user as any)?.accountHolderName || "");
  const [accountNumber, setAccountNumber] = useState((user as any)?.accountNumber || "");
  const [ifscCode, setIfscCode] = useState((user as any)?.ifscCode || "");
  const [bankName, setBankName] = useState((user as any)?.bankName || "");
  const [signaturePreview, setSignaturePreview] = useState<string | null>(user?.digitalSignature || null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  // Business rubber stamp — the companion to the signature on Indian
  // documents. Presentational only; nothing to do with stamp duty.
  const [sealPreview, setSealPreview] = useState<string | null>((user as any)?.companySeal || null);
  const [sealFile, setSealFile] = useState<File | null>(null);
  const sealInputRef = useRef<HTMLInputElement>(null);

  // Deep links (/profile?edit=1&section=bank etc. — used by the dashboard
  // checklist and the stepper) land straight in edit mode at the right
  // section. The user never lands on the read-only page hunting for Edit.
  // The scroll is driven by React lifecycle (not a blind timeout): it fires
  // only after the edit form has committed, with a late corrective pass for
  // layout shifts (cover image, entrance animation) on cold loads.
  const [pendingSection, setPendingSection] = useState<string | null>(null);
  const openEditor = (section?: string) => {
    setIsEditing(true);
    if (section) setPendingSection(section);
  };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("edit") === "1") openEditor(params.get("section") || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!isEditing || !pendingSection) return;
    const target = () => document.getElementById(`profile-section-${pendingSection}`);
    // First pass: smooth, right after the edit form commits.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => target()?.scrollIntoView({ behavior: "smooth", block: "start" })),
    );
    // Corrective pass: if the smooth scroll didn't land (layout shift, or an
    // environment that ignores smooth scrolling), jump. Must be "instant" —
    // "auto" defers to the html { scroll-behavior: smooth } rule and would
    // just restart the same smooth scroll that failed.
    const t = setTimeout(() => {
      const el = target();
      if (el && Math.abs(el.getBoundingClientRect().top - 96) > 120) {
        el.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });
      }
      setPendingSection(null);
    }, 700);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [isEditing, pendingSection]);

  const handleSealUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid File", description: "Please upload an image file (JPG, PNG, etc.)", variant: "destructive" });
      return;
    }
    setSealFile(file);
    const reader = new FileReader();
    reader.onload = (event) => setSealPreview(event.target?.result as string);
    reader.readAsDataURL(file);
  };

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
      queryClient.clear();
      window.location.href = "/";
    } catch (error) {
      toast({ title: "Failed to logout", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      let digitalSignaturePath = signaturePreview;
      let companySealPath = sealPreview;

      if (sealFile) {
        const sealForm = new FormData();
        sealForm.append("seal", sealFile);
        const sealRes = await fetch("/api/profile/seal", { method: "POST", body: sealForm, credentials: "include" });
        if (!sealRes.ok) throw new Error("Failed to upload seal");
        companySealPath = (await sealRes.json()).path;
      }

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
        panNumber: panNumber ? panNumber.toUpperCase() : null,
        gstNumber: gstNumber ? gstNumber.toUpperCase() : null,
        billingAddress: billingAddress.trim() || null,
        accountHolderName: accountHolderName.trim() || null,
        accountNumber: accountNumber.replace(/\s/g, "") || null,
        ifscCode: ifscCode ? ifscCode.toUpperCase() : null,
        bankName: bankName.trim() || null,
        digitalSignature: digitalSignaturePath,
        companySeal: companySealPath,
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
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      {/* Cover Header — uploadable image OR brand gradient fallback */}
      <div className="relative">
        <button
          type="button"
          onClick={() => coverInputRef.current?.click()}
          disabled={uploadingCover}
          className="group block w-full h-40 lg:h-56 relative overflow-hidden cursor-pointer disabled:cursor-wait"
          aria-label={user?.coverImageUrl ? "Change cover image" : "Upload cover image"}
          style={
            user?.coverImageUrl
              ? {
                  backgroundImage: `url(${user.coverImageUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : {
                  background:
                    "linear-gradient(135deg, hsl(160 84% 22%) 0%, hsl(160 84% 30%) 45%, hsl(174 77% 36%) 100%)",
                }
          }
          data-testid="button-cover-upload"
        >
          {/* Decorative overlays only on default gradient (not on real photo) */}
          {!user?.coverImageUrl && (
            <>
              <div
                className="absolute inset-0 opacity-60 pointer-events-none"
                style={{ background: "radial-gradient(ellipse at 80% 0%, rgba(255,255,255,0.18) 0%, transparent 55%)" }}
              />
              <div className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full border border-white/10 pointer-events-none" />
              <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full border border-white/10 pointer-events-none" />
              <div
                className="absolute inset-0 opacity-[0.05] pointer-events-none"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
                  backgroundSize: "32px 32px",
                }}
              />
            </>
          )}

          {/* Hover overlay for editing — semi-transparent + camera icon */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-200 flex items-end justify-end p-3 lg:p-4">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/40 backdrop-blur-sm text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
              {uploadingCover ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Camera className="w-3.5 h-3.5" />
                  {user?.coverImageUrl ? "Change cover" : "Upload cover"}
                </>
              )}
            </div>
          </div>

          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (!file.type.startsWith("image/")) {
                toast({ title: "Invalid file", description: "Upload an image.", variant: "destructive" });
                return;
              }
              if (file.size > 5 * 1024 * 1024) {
                toast({ title: "File too large", description: "Max 5MB.", variant: "destructive" });
                return;
              }
              setUploadingCover(true);
              try {
                const formData = new FormData();
                formData.append("cover", file);
                const res = await fetch("/api/profile/cover", {
                  method: "POST",
                  body: formData,
                  credentials: "include",
                });
                if (!res.ok) throw new Error("Upload failed");
                await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
                toast({ title: "Cover updated" });
              } catch (err: any) {
                toast({ title: "Upload failed", description: err.message, variant: "destructive" });
              } finally {
                setUploadingCover(false);
                if (coverInputRef.current) coverInputRef.current.value = "";
              }
            }}
          />
        </button>

        {/* Top action bar — consistent button sizing */}
        <div className="absolute top-0 left-0 right-0 px-4 pt-3 flex items-center justify-between z-10 pointer-events-none">
          <div className="pointer-events-auto">
            <Link href="/dashboard">
              <Button
                variant="ghost"
                size="icon"
                className="text-white bg-black/20 hover:bg-black/40 backdrop-blur-sm rounded-full h-9 w-9"
                data-testid="button-back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <div className="flex gap-2 pointer-events-auto">
            {!isEditing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openEditor()}
                className="text-white bg-black/25 hover:bg-black/45 backdrop-blur-sm rounded-full h-9 px-3.5 font-semibold"
                data-testid="button-edit-profile"
              >
                <Edit className="h-4 w-4 mr-1.5" />
                Edit Profile
              </Button>
            )}
            <Link href="/settings">
              <Button
                variant="ghost"
                size="sm"
                className="text-white bg-black/25 hover:bg-black/45 backdrop-blur-sm rounded-full h-9 px-3.5 font-semibold"
                data-testid="button-settings"
              >
                <SettingsIcon className="h-4 w-4 mr-1.5" />
                Settings
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="text-white bg-black/25 hover:bg-black/45 backdrop-blur-sm rounded-full h-9 px-3.5 font-semibold"
              onClick={handleLogout}
              data-testid="button-logout"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Avatar + Identity */}
      <div className="flex flex-col items-center -mt-12 relative z-10">
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          disabled={uploadingPhoto}
          className="group relative w-24 h-24 rounded-full shadow-lg ring-4 ring-background overflow-hidden disabled:opacity-70 focus:outline-none focus-visible:ring-primary"
          data-testid="button-profile-photo"
          aria-label="Change profile photo"
        >
          {user?.profileImageUrl ? (
            <img
              src={user.profileImageUrl}
              alt={fullName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-3xl font-bold text-white"
              style={{ background: "linear-gradient(135deg, hsl(160 84% 30%) 0%, hsl(174 77% 36%) 100%)" }}
            >
              {initials}
            </div>
          )}

          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
            {uploadingPhoto ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <div className="flex flex-col items-center gap-0.5">
                <Upload className="w-4 h-4" />
                <span className="text-[10px] font-semibold">
                  {user?.profileImageUrl ? "Replace" : "Upload"}
                </span>
              </div>
            )}
          </div>

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (!file.type.startsWith("image/")) {
                toast({ title: "Invalid file", description: "Upload an image.", variant: "destructive" });
                return;
              }
              if (file.size > 5 * 1024 * 1024) {
                toast({ title: "File too large", description: "Max 5MB.", variant: "destructive" });
                return;
              }
              setUploadingPhoto(true);
              try {
                const formData = new FormData();
                formData.append("photo", file);
                const res = await fetch("/api/profile/photo", {
                  method: "POST",
                  body: formData,
                  credentials: "include",
                });
                if (!res.ok) throw new Error("Upload failed");
                await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
                toast({ title: "Profile photo updated" });
              } catch (err: any) {
                toast({ title: "Upload failed", description: err.message, variant: "destructive" });
              } finally {
                setUploadingPhoto(false);
                if (photoInputRef.current) photoInputRef.current.value = "";
              }
            }}
          />
        </button>
      </div>

      {/* Name + email below avatar */}
      <div className="text-center mt-3 mb-6 px-4">
        <h2 className="text-xl font-bold" data-testid="text-fullname">{fullName}</h2>
        <p className="text-sm text-muted-foreground" data-testid="text-email">{user?.email || "No email"}</p>
      </div>

      <main className="px-4 space-y-4 max-w-lg mx-auto animate-fade-in lg:max-w-[1600px] lg:px-8 lg:space-y-6 xl:px-12">
        <SetupStepper
          steps={[
            { key: "identity",  label: "Personal",      icon: User,     done: Boolean(user?.firstName && user?.phone) },
            { key: "business",  label: "Business info", icon: Building, done: Boolean(user?.panNumber && (user as any)?.billingAddress) },
            { key: "bank",      label: "Bank details",  icon: Landmark, done: Boolean((user as any)?.accountNumber && (user as any)?.ifscCode && (user as any)?.accountHolderName) },
            { key: "signature", label: "Signature",     icon: PenTool,  done: Boolean(user?.digitalSignature) },
          ]}
          onStepClick={(k) => openEditor(k)}
        />
        {isEditing ? (
          /* ---- Edit Mode (form readable width even on wide screens) ---- */
          <div className="glass-card rounded-2xl p-5 lg:p-7 space-y-5 lg:max-w-3xl lg:mx-auto" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.5)" }}>
            <div className="flex items-center gap-2 mb-1">
              <Edit className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-lg">Edit Profile</h3>
            </div>
            <p className="text-sm text-muted-foreground -mt-3">Update your profile information</p>

            <section id="profile-section-identity" className="scroll-mt-24 space-y-4">
              <div className="flex items-center gap-2 pt-1">
                <User className="h-4 w-4 text-primary" />
                <h4 className="font-semibold text-sm">Personal</h4>
              </div>
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
            </section>

            <section id="profile-section-business" className="scroll-mt-24 space-y-4">
              <div className="flex items-center gap-2 pt-1">
                <Building className="h-4 w-4 text-primary" />
                <div>
                  <h4 className="font-semibold text-sm">Business info</h4>
                  <p className="text-xs text-muted-foreground">PAN &amp; billing address go on your agreements and GST invoices.</p>
                </div>
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
            </section>

            <div id="profile-section-bank" className="scroll-mt-24 rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-4">
              <div className="flex items-center gap-2">
                <Landmark className="h-4 w-4 text-primary" />
                <div>
                  <h4 className="font-semibold text-sm">Bank details</h4>
                  <p className="text-xs text-muted-foreground">Required for invoices — used to receive payments from brands.</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="accountHolderName">Account Holder Name</Label>
                <Input
                  id="accountHolderName"
                  value={accountHolderName}
                  onChange={(e) => setAccountHolderName(e.target.value)}
                  placeholder="As per bank records"
                  data-testid="input-account-holder"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="accountNumber">Account Number</Label>
                <Input
                  id="accountNumber"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                  placeholder="XXXXXXXXXXXX"
                  inputMode="numeric"
                  data-testid="input-account-number"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ifscCode">IFSC</Label>
                  <Input
                    id="ifscCode"
                    value={ifscCode}
                    onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                    placeholder="HDFC0001234"
                    maxLength={11}
                    data-testid="input-ifsc"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bankName">Bank Name</Label>
                  <Input
                    id="bankName"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="HDFC Bank"
                    data-testid="input-bank-name"
                  />
                </div>
              </div>
            </div>

            <section id="profile-section-signature" className="scroll-mt-24 space-y-2">
              <div className="flex items-center gap-2 pt-1">
                <PenTool className="h-4 w-4 text-primary" />
                <div>
                  <h4 className="font-semibold text-sm">Digital Signature</h4>
                  <p className="text-xs text-muted-foreground">Auto-applied to every agreement you create.</p>
                </div>
              </div>
              <div className="border-2 border-dashed border-border rounded-xl p-4">
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
            </section>

            <section id="profile-section-seal" className="scroll-mt-24 space-y-2">
              <div className="flex items-center gap-2 pt-1">
                <Stamp className="h-4 w-4 text-primary" />
                <div>
                  <h4 className="font-semibold text-sm">Company Stamp <span className="font-normal text-muted-foreground">(optional)</span></h4>
                  <p className="text-xs text-muted-foreground">
                    Your business rubber stamp. Printed beside your signature on agreements and invoices.
                  </p>
                </div>
              </div>
              <div className="border-2 border-dashed border-border rounded-xl p-4">
                {sealPreview ? (
                  <div className="space-y-2">
                    <img src={sealPreview} alt="Company stamp" className="max-h-24 mx-auto" data-testid="img-seal" />
                    <Button
                      type="button" variant="outline" size="sm" className="w-full glass-card"
                      onClick={() => { setSealPreview(null); setSealFile(null); }}
                      data-testid="button-remove-seal"
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="text-center">
                    <Button
                      type="button" variant="outline" className="glass-card"
                      onClick={() => sealInputRef.current?.click()}
                      data-testid="button-upload-seal"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Stamp
                    </Button>
                    <input ref={sealInputRef} type="file" accept="image/*" onChange={handleSealUpload} className="hidden" />
                  </div>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                This is your own business stamp — it is not stamp duty. Stamp duty is paid separately to the
                government; you can record an e-stamp certificate on each agreement.
              </p>
            </section>

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
          /* ---- View Mode: Card Grid (stack on mobile, 2-col on desktop) ---- */
          <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-5 lg:auto-rows-min">
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

            {/* Bank Details Card */}
            <div className="glass-card rounded-2xl p-5 border-0" style={{ background: "linear-gradient(135deg, hsl(var(--card)) 0%, hsl(var(--card) / 0.8) 100%)" }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">Bank Details</h3>
                </div>
                {!(user as any)?.accountNumber && (
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-2 py-0.5 rounded">
                    Required for invoices
                  </span>
                )}
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Account Holder</p>
                    <p className="font-medium" data-testid="text-account-holder">{(user as any)?.accountHolderName || "Not set"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Hash className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Account Number</p>
                    <p className="font-medium font-mono" data-testid="text-account-number">
                      {(user as any)?.accountNumber
                        ? `${"•".repeat(Math.max(0, (user as any).accountNumber.length - 4))}${(user as any).accountNumber.slice(-4)}`
                        : "Not set"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">IFSC</p>
                    <p className="font-medium font-mono" data-testid="text-ifsc">{(user as any)?.ifscCode || "Not set"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Building className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Bank Name</p>
                    <p className="font-medium" data-testid="text-bank-name">{(user as any)?.bankName || "Not set"}</p>
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

            {/* Plan card — plan only; deal limits are enforced server-side
                and explained by the upgrade modal, not counted in the UI.
                Pro wears the brand's own pairing (emerald tile + gold seal,
                like the logo); trial is the same family so it FEELS like Pro
                but reads distinctly; free/lapsed goes neutral graphite. Paid
                Pro is checked first — a Pro buyer mid-trial sees "Pro". */}
            <div
              className="rounded-2xl p-5 border-0 relative overflow-hidden"
              style={{
                background: hasActivePro(user)
                  ? "linear-gradient(135deg, hsl(160 84% 14%) 0%, hsl(160 84% 22%) 50%, hsl(174 77% 26%) 100%)"
                  : hasActiveTrial(user)
                    ? "linear-gradient(135deg, hsl(160 84% 22%) 0%, hsl(160 84% 30%) 50%, hsl(174 77% 36%) 100%)"
                    : "linear-gradient(135deg, hsl(215 28% 17%) 0%, hsl(215 25% 24%) 50%, hsl(210 20% 30%) 100%)",
              }}
            >
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-white/10 -mr-10 -mt-10" />
              <div className="absolute bottom-0 left-0 w-20 h-20 rounded-full bg-white/5 -ml-6 -mb-6" />
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-3">
                  {hasActivePro(user)
                    ? <Crown className="h-4 w-4 text-amber-400" />
                    : <Sparkles className="h-4 w-4 text-white/80" />}
                  <h3 className="font-semibold text-white/90">Your plan</h3>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-3xl font-bold text-white" data-testid="text-plan">
                      {hasActivePro(user) ? "DealInSec Pro" : hasActiveTrial(user) ? "Pro trial" : "Free"}
                    </p>
                    <p className="text-sm text-white/60 mt-1">
                      {hasActivePro(user)
                        ? `Unlimited workflow${user?.planExpiresAt ? ` · until ${new Date(user.planExpiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}`
                        : hasActiveTrial(user)
                          ? `${getTrialDaysLeft(user) === 1 ? "Last day" : `${getTrialDaysLeft(user)} days left`} · everything unlocked`
                          : hasLapsedTrial(user)
                            ? "Trial ended · your documents stay yours"
                            : "Deals & quotations · upgrade for agreements and invoices"}
                    </p>
                  </div>
                  <Link href="/pricing">
                    <Button
                      size="sm"
                      className="bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-sm"
                      data-testid="button-upgrade"
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      {hasActivePro(user) ? "Manage Plan" : "Upgrade"}
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
