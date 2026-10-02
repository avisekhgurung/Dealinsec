/** Quotation and agreement summaries, and a freshly created public link to copy. */
import { useState } from "react";
import { Check, Copy, ExternalLink, FileCheck, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { AgentCard } from "@shared/agent";
import { CardShell, Row } from "./card-shell";
import { OpenLink } from "./payment-card";

function LinkRow({ url, what }: { url: string; what: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: "Couldn't copy. Select the link and copy it." });
    }
  };
  return (
    <div className="space-y-2 border-t border-border/70 px-3.5 py-3" data-testid="link-row">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{what} link</p>
      <p className="break-all rounded-lg bg-muted/50 px-3 py-2 text-xs font-medium">{url}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={copy} className="h-9 text-xs font-semibold" data-testid="link-copy">
          {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />} {copied ? "Copied" : "Copy link"}
        </Button>
        <Button size="sm" variant="ghost" asChild className="h-9 text-xs font-semibold">
          <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-3.5 w-3.5" /> Preview</a>
        </Button>
        <p className="text-[11px] text-muted-foreground">Nothing has been sent. Share it yourself.</p>
      </div>
    </div>
  );
}

export function QuotationCard({ card }: { card: AgentCard }) {
  const d = card.data as any;
  return (
    <CardShell label="Quotation" icon={<FileText className="h-3 w-3" />} testId="quotation-card">
      {(d.version != null || d.status) && (
        <div className="grid grid-cols-2 gap-3 p-3.5">
          {d.version != null && <Row label="Version">v{d.version}</Row>}
          {d.status && <Row label="Status"><span className="capitalize">{d.status}</span></Row>}
          <Row label="Share link">{d.linkActive ? `Active${d.sharedAt ? ` since ${d.sharedAt}` : ""}` : "Not shared"}</Row>
          {d.acceptedAt && <Row label="Accepted">{d.acceptedAt}</Row>}
        </div>
      )}
      {d.url && <LinkRow url={d.url} what="Quotation" />}
      {d.route && <div className="border-t border-border/70 px-3.5 py-2.5"><OpenLink href={d.route}>Open quotation</OpenLink></div>}
    </CardShell>
  );
}

export function AgreementCard({ card }: { card: AgentCard }) {
  const d = card.data as any;
  return (
    <CardShell label="Agreement" icon={<FileCheck className="h-3 w-3" />} testId="agreement-card">
      {(d.status || d.value) && (
        <div className="grid grid-cols-2 gap-3 p-3.5">
          {d.value && <Row label="Value"><span className="tabular-nums">{d.value}</span></Row>}
          {d.status && <Row label="Status">{d.status}</Row>}
          {d.signedByYou != null && <Row label="Signed by you">{d.signedByYou ? "Yes" : "No"}</Row>}
          {d.signedByClient != null && <Row label="Signed by the client">{d.signedByClient ? "Yes" : "Not yet"}</Row>}
          {d.linkActive != null && !d.url && <Row label="Signing link">{d.linkActive ? "Active" : "None"}</Row>}
        </div>
      )}
      {d.url && <LinkRow url={d.url} what="Signing" />}
      {d.route && <div className="border-t border-border/70 px-3.5 py-2.5"><OpenLink href={d.route}>Open agreement</OpenLink></div>}
    </CardShell>
  );
}
