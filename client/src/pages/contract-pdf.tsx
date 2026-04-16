import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, Printer, Shield, Lock } from "lucide-react";
import type { Contract, Deal } from "@shared/schema";

export default function ContractPdfPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const backPath = `/contracts/${id}`;
  const contractsPath = "/contracts";

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

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="glass-header sticky top-0 z-40">
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
        <header className="glass-header sticky top-0 z-40">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation(contractsPath)} data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-bold">Agreement Not Found</h1>
          </div>
        </header>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-background pb-20 print:pb-0 print:min-h-0 print:bg-white">

        {/* Screen-only header */}
        <header className="glass-header sticky top-0 z-40 print:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-4">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setLocation(backPath)} data-testid="button-back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <h1 className="text-xl font-bold">Agreement Document</h1>
            </div>
            <Button onClick={handlePrint} className="gradient-btn text-white" data-testid="button-export-pdf">
              <Printer className="w-4 h-4 mr-2" />
              Print / Save PDF
            </Button>
          </div>
        </header>

        <main className="px-4 py-6 max-w-4xl mx-auto animate-fade-in print:px-0 print:py-0 print:max-w-none">

          {/* ── Header Banner ── */}
          <div className="rounded-2xl overflow-hidden mb-6 print:rounded-none print:mb-8 gradient-primary">
            <div className="px-8 py-7 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1">InfluDeal Platform</p>
                <h1 className="text-white text-2xl md:text-3xl font-extrabold tracking-wide uppercase">
                  Influencer Marketing Agreement
                </h1>
              </div>
              <div className="text-right text-white/90 text-sm space-y-0.5">
                <p className="font-semibold text-white">Ref: {contract.contractName}</p>
                <p>Dated: {formatDate(contract.startDate)}</p>
                {contract.exclusive && (
                  <span className="inline-flex items-center gap-1 bg-white/20 text-white text-xs font-semibold px-2 py-0.5 rounded-full mt-1">
                    <Lock className="w-3 h-3" /> Exclusive
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── Parties Section ── */}
          <div className="glass-card print:bg-white print:shadow-none print:border print:border-gray-200 rounded-xl p-6 mb-6 print:rounded-none">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4 print:text-gray-500">
              Parties to this Agreement
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Party A */}
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wide text-primary mb-3">
                  Party A — Creator / Influencer
                </div>
                <div className="text-sm space-y-1.5">
                  <div>
                    <span className="text-muted-foreground text-xs">Full Name</span>
                    <p className="font-semibold">{[user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "—"}</p>
                  </div>
                  {user?.billingAddress && (
                    <div>
                      <span className="text-muted-foreground text-xs">Address</span>
                      <p className="font-medium">{user.billingAddress}</p>
                    </div>
                  )}
                  {user?.panNumber && (
                    <div>
                      <span className="text-muted-foreground text-xs">PAN</span>
                      <p className="font-medium font-mono">{user.panNumber}</p>
                    </div>
                  )}
                  {user?.email && (
                    <div>
                      <span className="text-muted-foreground text-xs">Email</span>
                      <p className="font-medium">{user.email}</p>
                    </div>
                  )}
                  {user?.phone && (
                    <div>
                      <span className="text-muted-foreground text-xs">Phone</span>
                      <p className="font-medium">{user.phone}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Party B */}
              <div className="space-y-2 md:border-l md:border-white/10 md:pl-6 print:border-gray-200">
                <div className="text-xs font-bold uppercase tracking-wide text-primary mb-3">
                  Party B — Brand / Client
                </div>
                <div className="text-sm space-y-1.5">
                  <div>
                    <span className="text-muted-foreground text-xs">Brand Name</span>
                    <p className="font-semibold">{contract.brandName}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Deal Title</span>
                    <p className="font-medium">{deal?.dealTitle || contract.contractName}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Agreement Details ── */}
          <div className="glass-card print:bg-white print:shadow-none print:border print:border-gray-200 rounded-xl p-6 mb-6 print:rounded-none">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4 print:text-gray-500">
              Agreement Details
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground text-xs block mb-1">Effective Date</span>
                <span className="font-semibold">{formatDate(contract.startDate)}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block mb-1">End Date</span>
                <span className="font-semibold">{formatDate(contract.endDate)}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block mb-1">Deal Value</span>
                <span className="font-bold text-primary text-base">
                  ₹{contract.contractValue.toLocaleString("en-IN")}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block mb-1">Type</span>
                {contract.exclusive ? (
                  <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 no-default-hover-elevate no-default-active-elevate">
                    <Lock className="w-3 h-3 mr-1" />
                    Exclusive
                  </Badge>
                ) : (
                  <Badge variant="secondary">Non-Exclusive</Badge>
                )}
              </div>
            </div>
          </div>

          {/* ── Deliverables Table ── */}
          {deal?.deliverables && deal.deliverables.length > 0 && (
            <div className="glass-card print:bg-white print:shadow-none print:border print:border-gray-200 rounded-xl p-6 mb-6 print:rounded-none overflow-x-auto">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4 print:text-gray-500">
                Deliverables
              </h2>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-white/10 print:border-gray-300">
                    <th className="text-left pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground print:text-gray-500">Platform</th>
                    <th className="text-left pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground print:text-gray-500">Content Type</th>
                    <th className="text-left pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground print:text-gray-500">Qty</th>
                    <th className="text-left pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground print:text-gray-500">Frequency</th>
                    <th className="text-left pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground print:text-gray-500">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {deal.deliverables.map((d, i) => (
                    <tr
                      key={i}
                      className="border-b border-white/5 print:border-gray-100 last:border-0"
                    >
                      <td className="py-2.5 pr-4 font-medium">{d.platform}</td>
                      <td className="py-2.5 pr-4">{d.contentType}</td>
                      <td className="py-2.5 pr-4 font-semibold">{d.quantity}</td>
                      <td className="py-2.5 pr-4 capitalize">{d.frequency}</td>
                      <td className="py-2.5 text-muted-foreground text-xs">{d.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Numbered Clauses ── */}
          <div className="glass-card print:bg-white print:shadow-none print:border print:border-gray-200 rounded-xl p-6 mb-6 print:rounded-none space-y-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground print:text-gray-500">
              Terms &amp; Conditions
            </h2>

            {/* Clause 1 */}
            <div className="space-y-1.5">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">1</span>
                Scope of Work
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed pl-8 print:text-gray-700">
                The Creator agrees to provide influencer marketing and content creation services for the Brand
                as described in the Deliverables section above, in connection with the deal titled
                "{deal?.dealTitle || contract.contractName}". All content shall be original, professionally produced,
                and compliant with applicable advertising standards and platform policies.
              </p>
            </div>

            {/* Clause 2 */}
            <div className="space-y-1.5">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">2</span>
                Deliverables &amp; Timeline
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed pl-8 print:text-gray-700">
                All deliverables shall be submitted for Brand approval at least 48 hours before the scheduled
                publication date. The Brand shall provide approval or revision requests within 24 hours of receipt.
                The Creator shall incorporate up to two (2) rounds of revisions at no additional charge.
                This Agreement is effective from <strong>{formatDate(contract.startDate)}</strong> through{" "}
                <strong>{formatDate(contract.endDate)}</strong>.
              </p>
            </div>

            {/* Clause 3 */}
            <div className="space-y-1.5">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">3</span>
                Compensation (₹{contract.contractValue.toLocaleString("en-IN")})
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed pl-8 print:text-gray-700">
                In consideration for the services rendered, the Brand shall pay the Creator a total fee of{" "}
                <strong>₹{contract.contractValue.toLocaleString("en-IN")}</strong> (Indian Rupees{" "}
                {contract.contractValue.toLocaleString("en-IN")} only). Payment shall be structured as:
                50% advance upon execution and 50% within 30 days of final deliverable approval.
                Late payments attract interest at 1.5% per month.
              </p>
            </div>

            {/* Clause 4 */}
            <div className="space-y-1.5">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">4</span>
                Content Rights &amp; Usage
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed pl-8 print:text-gray-700">
                Upon full payment, the Creator grants the Brand a non-exclusive, worldwide, royalty-free license
                to use, reproduce, display, and distribute the content for marketing and promotional purposes for
                12 months following the Agreement expiry. The Creator retains all ownership rights and may use
                content for personal portfolio purposes.
              </p>
            </div>

            {/* Clause 5 */}
            <div className="space-y-1.5">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">5</span>
                Exclusivity Terms
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed pl-8 print:text-gray-700">
                {contract.exclusive
                  ? "This Agreement is EXCLUSIVE. During the Agreement period, the Creator shall not enter into similar influencer marketing arrangements with direct competitors of the Brand without prior written consent. All brand deals during this period must be registered on the InfluDeal platform."
                  : "This Agreement is NON-EXCLUSIVE. The Creator may engage with other brands and clients during the Agreement period, provided such engagements do not directly conflict with or diminish the promotional value of this Agreement."}
              </p>
            </div>

            {/* Clause 6 */}
            <div className="space-y-1.5">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">6</span>
                Governing Law (Indian Contract Act 1872)
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed pl-8 print:text-gray-700">
                This Agreement shall be governed by and construed in accordance with the laws of India,
                including the Indian Contract Act, 1872. Any disputes shall first be attempted to be resolved
                through good-faith negotiation for 30 days, failing which disputes shall be submitted to
                binding arbitration under the Arbitration and Conciliation Act, 1996. The courts of India
                shall have exclusive jurisdiction for any legal proceedings.
              </p>
            </div>
          </div>

          {/* ── Signature Blocks ── */}
          <div className="glass-card print:bg-white print:shadow-none print:border print:border-gray-200 rounded-xl p-6 mb-6 print:rounded-none">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6 print:text-gray-500">
              Signatures
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

              {/* Creator Signature */}
              <div className="space-y-4">
                <p className="text-xs font-bold uppercase tracking-wide text-primary">
                  Party A — Creator / Influencer
                </p>

                {/* Signature image or placeholder */}
                <div className="min-h-[100px] border-2 border-dashed border-white/20 print:border-gray-300 rounded-xl flex items-center justify-center bg-white/5 print:bg-gray-50 overflow-hidden">
                  {user?.digitalSignature ? (
                    <img
                      src={user.digitalSignature}
                      alt="Creator Signature"
                      className="max-h-24 max-w-full object-contain p-2"
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground/60 text-center px-4 print:text-gray-400">
                      Signature on file
                    </p>
                  )}
                </div>

                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1 print:text-gray-500">Printed Name</p>
                    <div className="border-b-2 border-foreground/30 print:border-gray-400 pb-1 font-medium">
                      {[user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || ""}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1 print:text-gray-500">Date</p>
                    <div className="border-b-2 border-foreground/30 print:border-gray-400 pb-1">
                      {contract.signedDate ? formatDate(contract.signedDate) : formatDate(contract.startDate)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Brand Signature */}
              <div className="space-y-4 md:border-l md:border-white/10 md:pl-8 print:border-gray-200">
                <p className="text-xs font-bold uppercase tracking-wide text-primary">
                  Party B — Brand / Client
                </p>

                {contract.signedByBrand ? (
                  <>
                    <div className="min-h-[100px] border-2 border-dashed border-white/20 print:border-gray-300 rounded-xl flex items-center justify-center bg-white/5 print:bg-gray-50">
                      <div className="text-center">
                        <Shield className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">Digitally Executed</p>
                      </div>
                    </div>
                    <div className="space-y-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1 print:text-gray-500">Authorised Signatory</p>
                        <div className="border-b-2 border-foreground/30 print:border-gray-400 pb-1 font-medium">
                          {contract.brandName}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1 print:text-gray-500">Date</p>
                        <div className="border-b-2 border-foreground/30 print:border-gray-400 pb-1">
                          {contract.signedDate ? formatDate(contract.signedDate) : formatDate(contract.startDate)}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="min-h-[100px] border-2 border-dashed border-white/20 print:border-gray-300 rounded-xl flex items-center justify-center bg-white/5 print:bg-gray-50">
                      <p className="text-xs text-muted-foreground/60 text-center px-4 print:text-gray-400">
                        Authorised Signatory
                      </p>
                    </div>
                    <div className="space-y-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1 print:text-gray-500">Full Name</p>
                        <div className="border-b-2 border-foreground/30 print:border-gray-400 h-8" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1 print:text-gray-500">Date</p>
                        <div className="border-b-2 border-foreground/30 print:border-gray-400 h-8" />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Footer (print only) ── */}
          <div className="hidden print:block mt-10 pt-6 border-t border-gray-200 text-center text-xs text-gray-400 space-y-1">
            <p className="font-semibold text-gray-600">End of Agreement</p>
            <p>Reference: {contract.contractName}</p>
            <p>Agreement Period: {formatDate(contract.startDate)} — {formatDate(contract.endDate)}</p>
            <p>Agreement Value: ₹{contract.contractValue.toLocaleString("en-IN")}</p>
            <p className="mt-2">Generated via InfluDeal Platform · Governed by Indian Contract Act 1872</p>
          </div>

          {/* ── Screen action buttons ── */}
          <div className="flex gap-3 print:hidden mt-2">
            <Button
              variant="outline"
              className="flex-1 h-12 rounded-xl"
              onClick={() => setLocation(backPath)}
              data-testid="button-back-bottom"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button
              className="flex-1 h-12 rounded-xl gradient-btn text-white"
              onClick={handlePrint}
              data-testid="button-print-bottom"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print / Save PDF
            </Button>
          </div>

        </main>
      </div>

      <style>{`
        @media print {
          body {
            background: #ffffff !important;
          }
          body * {
            visibility: hidden;
          }
          main, main * {
            visibility: visible;
          }
          main {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: #ffffff;
          }
          .print\\:hidden {
            display: none !important;
          }
          .gradient-primary {
            background: #6d28d9 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          @page {
            margin: 1.2cm;
            size: A4;
          }
        }
      `}</style>
    </>
  );
}
