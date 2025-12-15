import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, Download, Building2, Shield, CheckCircle } from "lucide-react";
import type { Contract, Deal } from "@shared/schema";

export default function ContractPdfPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const isBrand = user?.role === "brand";
  const backPath = isBrand ? `/brand/contracts/${id}` : `/contracts/${id}`;
  const contractsPath = isBrand ? "/brand/contracts" : "/contracts";

  const { data: contract, isLoading } = useQuery<Contract>({
    queryKey: ["/api/contracts", id],
  });

  const { data: deal } = useQuery<Deal>({
    queryKey: ["/api/deals", contract?.dealId],
    enabled: !!contract?.dealId,
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const handleExportPDF = () => {
    window.print();
  };

  const getDeliverablesSummary = () => {
    if (!deal?.deliverables || deal.deliverables.length === 0) {
      return "content creation and promotional services as mutually agreed";
    }
    
    const deliverableTexts = deal.deliverables.map((d, i) => {
      return `(${i + 1}) ${d.quantity} ${d.contentType}${d.quantity > 1 ? 's' : ''} on ${d.platform} platform, delivered ${d.frequency.toLowerCase()}`;
    });
    
    return deliverableTexts.join('; ');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 py-4">
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-6 w-32" />
          </div>
        </header>
        <div className="px-4 py-6 space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation(contractsPath)} data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-bold">Contract Not Found</h1>
          </div>
        </header>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-background pb-20 print:pb-0 print:min-h-0">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border print:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-4">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setLocation(backPath)} data-testid="button-back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <h1 className="text-xl font-bold">Contract Agreement</h1>
            </div>
            <Button onClick={handleExportPDF} data-testid="button-export-pdf">
              <Download className="w-4 h-4 mr-2" />
              Export PDF
            </Button>
          </div>
        </header>

        <main className="px-4 py-6 space-y-6 print:px-12 print:py-8 max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h1 className="text-2xl font-bold tracking-wide uppercase print:text-3xl">Influencer Marketing Agreement</h1>
            <p className="text-sm text-muted-foreground mt-2">Reference: {contract.contractName}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Effective Date: {formatDate(contract.startDate)}
            </p>
          </div>

          <Card className="print:shadow-none print:border-0">
            <CardContent className="p-6 space-y-8 text-sm leading-relaxed print:p-0">
              
              <section>
                <h2 className="text-base font-bold mb-4 uppercase tracking-wide border-b pb-2">Article 1: Parties and Recitals</h2>
                <p className="text-muted-foreground mb-3">
                  This Influencer Marketing Agreement ("Agreement") is made and entered into as of {formatDate(contract.startDate)} 
                  by and between <strong>{contract.brandName}</strong> (hereinafter referred to as the "Brand" or "Client"), 
                  and the content creator engaged pursuant to the underlying deal arrangement (hereinafter referred to as the "Creator").
                </p>
                <p className="text-muted-foreground mb-3">
                  WHEREAS, the Brand desires to engage the Creator to provide content creation, promotion, and influencer 
                  marketing services; and WHEREAS, the Creator possesses the skills, experience, and audience reach necessary 
                  to perform such services; NOW, THEREFORE, in consideration of the mutual covenants and agreements set forth 
                  herein, the parties agree as follows.
                </p>
                {contract.exclusive && (
                  <div className="flex items-center gap-2 p-3 bg-violet-50 dark:bg-violet-900/20 rounded-md mt-4">
                    <Shield className="w-5 h-5 text-violet-600 dark:text-violet-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-violet-700 dark:text-violet-400">
                      This Agreement is designated as an Exclusive Partnership Arrangement
                    </span>
                  </div>
                )}
              </section>

              <section>
                <h2 className="text-base font-bold mb-4 uppercase tracking-wide border-b pb-2">Article 2: Term and Duration</h2>
                <p className="text-muted-foreground mb-3">
                  <strong>2.1 Effective Date.</strong> This Agreement shall become effective on {formatDate(contract.startDate)} 
                  (the "Effective Date") and shall continue in full force and effect until {formatDate(contract.endDate)} 
                  (the "Expiration Date"), unless earlier terminated in accordance with Article 7 of this Agreement.
                </p>
                <p className="text-muted-foreground">
                  <strong>2.2 Renewal.</strong> This Agreement may be renewed or extended only by mutual written agreement 
                  of both parties, executed at least fifteen (15) days prior to the Expiration Date. Any such renewal shall 
                  be subject to renegotiation of terms, including but not limited to compensation and scope of services.
                </p>
              </section>

              <section>
                <h2 className="text-base font-bold mb-4 uppercase tracking-wide border-b pb-2">Article 3: Scope of Work and Deliverables</h2>
                <p className="text-muted-foreground mb-3">
                  <strong>3.1 Services.</strong> The Creator agrees to provide content creation and promotional services 
                  as specified in the underlying deal arrangement titled "{deal?.dealTitle || contract.contractName}". 
                  The specific deliverables shall include: {getDeliverablesSummary()}.
                </p>
                <p className="text-muted-foreground mb-3">
                  <strong>3.2 Content Standards.</strong> All content delivered under this Agreement shall be original, 
                  professionally produced, and compliant with all applicable advertising standards, Federal Trade Commission 
                  guidelines, and platform-specific policies. The Creator shall clearly disclose the sponsored nature of all 
                  content in accordance with applicable disclosure requirements.
                </p>
                <p className="text-muted-foreground mb-3">
                  <strong>3.3 Approval Process.</strong> The Brand shall have the right to review and approve all content 
                  prior to publication. The Creator shall submit content for review at least forty-eight (48) hours before 
                  the scheduled publication date. The Brand shall provide approval or revision requests within twenty-four (24) 
                  hours of receipt. Failure to respond within this period shall constitute deemed approval.
                </p>
                <p className="text-muted-foreground">
                  <strong>3.4 Revisions.</strong> The Creator shall make up to two (2) rounds of revisions to any content 
                  at no additional cost, provided such revision requests are made within the approval period and do not 
                  materially alter the original scope of the deliverable.
                </p>
              </section>

              <section>
                <h2 className="text-base font-bold mb-4 uppercase tracking-wide border-b pb-2">Article 4: Compensation and Payment</h2>
                <p className="text-muted-foreground mb-3">
                  <strong>4.1 Total Compensation.</strong> In consideration for the services rendered under this Agreement, 
                  the Brand agrees to pay the Creator a total fee of <strong>₹{contract.contractValue.toLocaleString("en-IN")}</strong> 
                  (Indian Rupees {contract.contractValue.toLocaleString("en-IN")} only) (the "Contract Value").
                </p>
                <p className="text-muted-foreground mb-3">
                  <strong>4.2 Payment Schedule.</strong> Unless otherwise agreed in writing, payment shall be structured 
                  as follows: (a) Fifty percent (50%) of the Contract Value shall be payable upon execution of this Agreement 
                  as an advance payment; and (b) The remaining fifty percent (50%) shall be payable within thirty (30) days 
                  following the successful completion and approval of all deliverables specified herein.
                </p>
                <p className="text-muted-foreground mb-3">
                  <strong>4.3 Payment Method.</strong> All payments shall be made via electronic bank transfer to the 
                  account designated by the Creator. The Creator shall be responsible for providing accurate banking 
                  information and for any applicable taxes on income received.
                </p>
                <p className="text-muted-foreground">
                  <strong>4.4 Late Payment.</strong> In the event of late payment, the Brand shall pay interest on any 
                  outstanding amounts at the rate of one and one-half percent (1.5%) per month, or the maximum rate 
                  permitted by law, whichever is lower.
                </p>
              </section>

              <section>
                <h2 className="text-base font-bold mb-4 uppercase tracking-wide border-b pb-2">Article 5: Intellectual Property Rights</h2>
                <p className="text-muted-foreground mb-3">
                  <strong>5.1 License Grant.</strong> Upon full payment of the Contract Value, the Creator grants to the 
                  Brand a non-exclusive, worldwide, royalty-free license to use, reproduce, modify, display, and distribute 
                  the content created under this Agreement for marketing and promotional purposes.
                </p>
                <p className="text-muted-foreground mb-3">
                  <strong>5.2 License Duration.</strong> The license granted herein shall remain in effect for a period 
                  of twelve (12) months following the later of: (a) the Expiration Date; or (b) the date of final payment. 
                  Thereafter, the Brand may negotiate an extension of the license at mutually agreeable terms.
                </p>
                <p className="text-muted-foreground">
                  <strong>5.3 Creator Rights.</strong> The Creator retains all ownership rights in the original content 
                  and may use such content for personal portfolio, promotional, and non-commercial purposes, provided 
                  such use does not compete with or diminish the value of the Brand's licensed use.
                </p>
              </section>

              <section>
                <h2 className="text-base font-bold mb-4 uppercase tracking-wide border-b pb-2">Article 6: Confidentiality</h2>
                <p className="text-muted-foreground mb-3">
                  <strong>6.1 Confidential Information.</strong> Each party acknowledges that it may receive confidential 
                  and proprietary information from the other party, including but not limited to business strategies, 
                  marketing plans, financial information, trade secrets, and technical data ("Confidential Information").
                </p>
                <p className="text-muted-foreground mb-3">
                  <strong>6.2 Non-Disclosure.</strong> Each party agrees to: (a) hold all Confidential Information in 
                  strict confidence; (b) use such information solely for the purposes of performing obligations under 
                  this Agreement; and (c) not disclose such information to any third party without prior written consent, 
                  except as required by law.
                </p>
                <p className="text-muted-foreground">
                  <strong>6.3 Duration.</strong> The obligations of confidentiality set forth in this Article shall 
                  survive the termination or expiration of this Agreement for a period of two (2) years. The financial 
                  terms of this Agreement shall be treated as Confidential Information of both parties.
                </p>
              </section>

              <section>
                <h2 className="text-base font-bold mb-4 uppercase tracking-wide border-b pb-2">Article 7: Termination</h2>
                <p className="text-muted-foreground mb-3">
                  <strong>7.1 Termination for Convenience.</strong> Either party may terminate this Agreement without 
                  cause by providing thirty (30) days written notice to the other party.
                </p>
                <p className="text-muted-foreground mb-3">
                  <strong>7.2 Termination for Cause.</strong> Either party may terminate this Agreement immediately 
                  upon written notice if the other party: (a) materially breaches any provision of this Agreement and 
                  fails to cure such breach within ten (10) days of receiving written notice; (b) becomes insolvent or 
                  files for bankruptcy; or (c) engages in conduct that materially damages the reputation of the other party.
                </p>
                <p className="text-muted-foreground mb-3">
                  <strong>7.3 Effect of Termination.</strong> Upon termination: (a) the Creator shall be entitled to 
                  compensation for all completed and approved deliverables up to the date of termination; (b) any advance 
                  payments for undelivered services shall be promptly refunded; and (c) all Confidential Information 
                  shall be returned or destroyed.
                </p>
                <p className="text-muted-foreground">
                  <strong>7.4 Force Majeure.</strong> Neither party shall be liable for any failure or delay in 
                  performance due to circumstances beyond its reasonable control, including but not limited to acts of 
                  God, natural disasters, war, terrorism, strikes, or government actions. In such event, the affected 
                  party shall promptly notify the other and make reasonable efforts to mitigate the impact.
                </p>
              </section>

              <section>
                <h2 className="text-base font-bold mb-4 uppercase tracking-wide border-b pb-2">Article 8: General Provisions</h2>
                <p className="text-muted-foreground mb-3">
                  <strong>8.1 Entire Agreement.</strong> This Agreement constitutes the entire understanding between 
                  the parties and supersedes all prior negotiations, representations, warranties, and agreements relating 
                  to this subject matter.
                </p>
                <p className="text-muted-foreground mb-3">
                  <strong>8.2 Amendments.</strong> No modification or amendment of this Agreement shall be binding unless 
                  made in writing and signed by both parties.
                </p>
                <p className="text-muted-foreground mb-3">
                  <strong>8.3 Governing Law.</strong> This Agreement shall be governed by and construed in accordance 
                  with the laws of India. Any disputes arising under this Agreement shall be subject to the exclusive 
                  jurisdiction of the courts located in the territory where the Brand maintains its principal place of business.
                </p>
                <p className="text-muted-foreground mb-3">
                  <strong>8.4 Dispute Resolution.</strong> Prior to initiating any legal proceedings, the parties agree 
                  to attempt to resolve any dispute through good faith negotiation for a period of thirty (30) days. 
                  If negotiation fails, disputes may be submitted to binding arbitration in accordance with the 
                  Arbitration and Conciliation Act, 1996.
                </p>
                <p className="text-muted-foreground">
                  <strong>8.5 Indemnification.</strong> Each party agrees to indemnify, defend, and hold harmless the 
                  other party from and against any claims, damages, losses, and expenses (including reasonable attorney's 
                  fees) arising out of or related to: (a) any breach of this Agreement; (b) any violation of applicable 
                  laws; or (c) any infringement of third-party intellectual property rights.
                </p>
              </section>

            </CardContent>
          </Card>

          <Card className="print:shadow-none print:border mt-8">
            <CardHeader className="pb-4">
              <CardTitle className="text-base uppercase tracking-wide">Brand Authorization and Execution</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-6">
                IN WITNESS WHEREOF, the undersigned authorized representative of the Brand has executed this Agreement 
                as of the date set forth below, thereby confirming acceptance of all terms and conditions herein and 
                authorizing the commencement of the engagement.
              </p>
              
              <div className="border-t pt-6">
                <div className="flex items-center gap-2 mb-6">
                  <Building2 className="w-5 h-5 text-muted-foreground" />
                  <p className="font-bold text-lg">For and on behalf of: {contract.brandName}</p>
                  {contract.signedByBrand && (
                    <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 no-default-hover-elevate no-default-active-elevate ml-2">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Executed
                    </Badge>
                  )}
                </div>
                
                {contract.signedByBrand ? (
                  <div className="p-6 bg-muted/50 rounded-lg">
                    <p className="text-base font-semibold mb-1">{contract.brandName}</p>
                    <p className="text-sm text-muted-foreground mb-3">Authorized Representative</p>
                    <p className="text-sm text-muted-foreground">
                      Executed on: {contract.signedDate ? formatDate(contract.signedDate) : formatDate(contract.startDate)}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Authorized Signature</p>
                      <div className="border-2 border-dashed border-muted-foreground/30 rounded-lg min-h-[140px] flex items-center justify-center bg-muted/10">
                        <p className="text-sm text-muted-foreground/60 text-center px-4">
                          Sign here or affix signature image
                        </p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Full Name of Signatory</p>
                        <div className="border-b-2 border-foreground h-10"></div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Designation / Title</p>
                        <div className="border-b-2 border-foreground h-10"></div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Date of Execution</p>
                        <div className="border-b-2 border-foreground h-10"></div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Company Seal / Stamp</p>
                        <div className="border-2 border-dashed border-muted-foreground/30 rounded-lg min-h-[80px] flex items-center justify-center bg-muted/10">
                          <p className="text-xs text-muted-foreground/60">Affix seal here</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="print:block hidden mt-12 pt-6 border-t text-center text-xs text-muted-foreground">
            <p className="font-medium">End of Agreement</p>
            <p className="mt-2">Reference: {contract.contractName}</p>
            <p>Contract Period: {formatDate(contract.startDate)} through {formatDate(contract.endDate)}</p>
            <p>Contract Value: ₹{contract.contractValue.toLocaleString("en-IN")}</p>
            <p className="mt-2">Generated via InfluDeal Platform</p>
          </div>
        </main>
      </div>

      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:block,
          .print\\:block * {
            visibility: visible;
          }
          main, main * {
            visibility: visible;
          }
          main {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          @page {
            margin: 1.5cm;
          }
        }
      `}</style>
    </>
  );
}
