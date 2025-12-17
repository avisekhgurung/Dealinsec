import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, ArrowLeft, Edit, LogOut, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useLocation, Link } from "wouter";
import { BottomNav } from "@/components/bottom-nav";

export default function ProfilePage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [panNumber, setPanNumber] = useState(user?.panNumber || "");
  const [gstNumber, setGstNumber] = useState(user?.gstNumber || "");
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

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-50 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">Profile</h1>
        <div className="ml-auto flex gap-2">
          {!isEditing && (
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)} data-testid="button-edit-profile">
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="p-4 space-y-4 max-w-lg mx-auto">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Contract Credits</CardTitle>
              <Link href="/pricing">
                <Button size="sm" data-testid="button-buy-credits">
                  <CreditCard className="h-4 w-4 mr-2" />
                  Buy Credits
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-credits">
              {user?.contractCredits ?? 0}
            </div>
            <p className="text-sm text-muted-foreground">Available credits</p>
          </CardContent>
        </Card>

        {isEditing ? (
          <Card>
            <CardHeader>
              <CardTitle>Edit Profile</CardTitle>
              <CardDescription>Update your profile information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                <Label>Digital Signature</Label>
                <div className="border-2 border-dashed rounded-md p-4">
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
                        className="w-full"
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

              <div className="flex gap-2">
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
                  className="flex-1"
                  onClick={handleSave}
                  disabled={isLoading}
                  data-testid="button-save-profile"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label className="text-muted-foreground">Full Name</Label>
                <p className="font-medium" data-testid="text-fullname">{fullName}</p>
              </div>

              <div className="space-y-1">
                <Label className="text-muted-foreground">Email</Label>
                <p className="font-medium" data-testid="text-email">{user?.email || "Not set"}</p>
              </div>

              <div className="space-y-1">
                <Label className="text-muted-foreground">Phone</Label>
                <p className="font-medium" data-testid="text-phone">{user?.phone || "Not set"}</p>
              </div>

              <div className="space-y-1">
                <Label className="text-muted-foreground">PAN Number</Label>
                <p className="font-medium" data-testid="text-pan">{user?.panNumber || "Not set"}</p>
              </div>

              <div className="space-y-1">
                <Label className="text-muted-foreground">GST Number</Label>
                <p className="font-medium" data-testid="text-gst">{user?.gstNumber || "Not set"}</p>
              </div>

              {user?.digitalSignature && (
                <div className="space-y-1">
                  <Label className="text-muted-foreground">Digital Signature</Label>
                  <img
                    src={user.digitalSignature}
                    alt="Signature"
                    className="max-h-16"
                    data-testid="img-signature-view"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
