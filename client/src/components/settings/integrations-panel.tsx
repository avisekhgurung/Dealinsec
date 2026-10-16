/**
 * Settings → Integrations. Gmail is the only real one: GmailCard decides for itself what to show, and this panel only
 * fills the gaps it leaves (loading, a failed load, or Gmail not switched on for this workspace), reading the same
 * GET /api/integrations/gmail answer, so it never says "connected" unless the server does. The other cards are
 * integrations that do NOT exist: no connect button, no dates, no promises.
 */
import { Mail, MessageCircle, Inbox, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadError } from "@/components/load-error";
import { GmailCard } from "@/components/settings/gmail-card";
import { SettingsSection } from "@/components/settings/section-card";
import { useGmailStatus } from "@/lib/gmail";

function UnavailableIntegration({ name, icon, status, description, testId }: { name: string; icon: LucideIcon; status: string; description: string; testId: string }) {
  return (
    <SettingsSection
      title={name}
      icon={icon}
      description={description}
      action={<Badge variant="outline" className="font-medium text-muted-foreground" data-testid={`${testId}-status`}>{status}</Badge>}
      testId={testId}
    />
  );
}

export function IntegrationsPanel() {
  const { data, isLoading, error, refetch, isFetching } = useGmailStatus();
  // Mirrors GmailCard's own rule for hiding itself (not available here, nothing connected).
  const gmailOff = !!data && !error && !data.available && !data.connection;

  return (
    <>
      {/* Always mounted: on the way back from Google it reads ?gmail=<outcome>, shows it and scrolls to itself. */}
      <GmailCard />

      {isLoading && (
        <Card className="glass-card" aria-busy="true" data-testid="gmail-loading">
          <CardContent className="space-y-3 p-5 lg:p-6">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full max-w-md" />
            <Skeleton className="h-9 w-36 rounded-lg" />
          </CardContent>
        </Card>
      )}

      {error && !isLoading && (
        <SettingsSection title="Gmail" icon={Mail} testId="gmail-load-error">
          <div className="-mx-4">
            <LoadError compact what="your Gmail connection" onRetry={() => void refetch()} retrying={isFetching} />
          </div>
        </SettingsSection>
      )}

      {gmailOff && (
        <UnavailableIntegration
          name="Gmail"
          icon={Mail}
          status="Not switched on"
          description="Not switched on for your workspace, so there is nothing to connect. Connecting your own Gmail lets approved messages go out from your address."
          testId="gmail-unavailable"
        />
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <UnavailableIntegration
          name="Microsoft 365 / Outlook"
          icon={Inbox}
          status="Not available yet"
          description="Would let approved messages go out from your own Microsoft 365 or Outlook address."
          testId="integration-outlook"
        />
        <UnavailableIntegration
          name="WhatsApp Business"
          icon={MessageCircle}
          status="Not available yet"
          description="Would let you send approved messages to clients from your WhatsApp Business number."
          testId="integration-whatsapp"
        />
      </div>
    </>
  );
}
