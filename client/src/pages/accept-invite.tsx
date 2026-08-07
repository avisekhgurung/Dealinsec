/**
 * Public invitation-accept page (/invite/:token).
 * Shows who invited them where, collects name + password, joins the org and
 * lands them on the dashboard already signed in.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { DealinsecLogo } from "@/components/dealinsec-logo";
import { Users, Loader2, AlertTriangle } from "lucide-react";

interface InviteInfo { email: string; orgRole: string; orgName: string; }

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: invite, isLoading, isError } = useQuery<InviteInfo>({
    queryKey: [`/api/invitations/${token}`],
    retry: false,
  });

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast({ title: "Password too short", description: "Use at least 6 characters.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/invitations/${token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ firstName, lastName, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not accept the invitation");
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: `Welcome to ${invite?.orgName}! 🎉` });
      setLocation("/dashboard");
    } catch (err: any) {
      toast({ title: "Could not join", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-10">
      <div className="mb-8"><DealinsecLogo size="md" withText /></div>

      <Card className="glass-card w-full max-w-md">
        <CardContent className="p-6 sm:p-8">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          ) : isError || !invite ? (
            <div className="text-center space-y-3 py-4">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-amber-600" />
              </div>
              <h1 className="text-lg font-bold">This invitation isn't valid</h1>
              <p className="text-sm text-muted-foreground">
                It may have expired or been revoked. Ask your organization owner to send a new one.
              </p>
            </div>
          ) : (
            <>
              <div className="text-center mb-6">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                  <Users className="w-6 h-6 text-primary" />
                </div>
                <h1 className="text-xl font-bold" style={{ textWrap: "balance" }}>
                  Join {invite.orgName}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  You've been invited as <b>{invite.orgRole.charAt(0) + invite.orgRole.slice(1).toLowerCase()}</b> · {invite.email}
                </p>
              </div>

              <form onSubmit={accept} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="fn">First name</Label>
                    <Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} required data-testid="input-first-name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ln">Last name</Label>
                    <Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw">Create a password</Label>
                  <Input id="pw" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="input-password" />
                </div>
                <Button type="submit" className="w-full h-11 gradient-btn text-white font-semibold" disabled={submitting} data-testid="button-accept-invite">
                  {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Accept Invitation & Join
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground mt-6">DealInSec · deal management for Indian service businesses</p>
    </div>
  );
}
