import type { AgentCard } from "@shared/agent";
import type { ApprovalView } from "@/hooks/use-agent";
import { ApprovalCard } from "./cards/approval-card";
import { DealCard } from "./cards/deal-card";
import { AgreementCard, QuotationCard } from "./cards/document-card";
import { FindingsCard } from "./cards/findings-card";
import { CompaniesCard } from "./cards/companies-card";
import { LeadCard } from "./cards/lead-card";
import { InvoiceCard, PaymentCard } from "./cards/payment-card";

/** One card, chosen by kind. A kind this build doesn't know renders nothing rather than breaking the thread. */
export function CardView({
  card, approvals, onApprove, onDecline, onEditDraft,
}: {
  card: AgentCard;
  approvals: Record<string, ApprovalView>;
  onApprove: (approvalId: string, tool: string) => void;
  onDecline: (approvalId: string, tool: string) => void;
  onEditDraft?: (prefill: Record<string, unknown>) => void;
}) {
  switch (card.kind) {
    case "approval":
      return <ApprovalCard card={card} view={approvals[String(card.data.approvalId)]} onApprove={onApprove} onDecline={onDecline} onEditDraft={onEditDraft} />;
    case "deal": return <DealCard card={card} />;
    case "findings": return <FindingsCard card={card} />;
    case "quotation": return <QuotationCard card={card} />;
    case "agreement": return <AgreementCard card={card} />;
    case "invoice": return <InvoiceCard card={card} />;
    case "payment": return <PaymentCard card={card} />;
    case "lead": return <LeadCard card={card} />;
    case "companies": return <CompaniesCard card={card} />;
    default: return null;
  }
}
