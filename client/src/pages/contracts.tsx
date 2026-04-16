import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BottomNav } from "@/components/bottom-nav";
import { StatusBadge } from "@/components/status-badge";
import { FileText, Calendar, Shield, ChevronRight, FileCheck } from "lucide-react";
import type { Contract, Invoice } from "@shared/schema";

type FilterType = "all" | "active" | "completed";

export default function ContractsPage() {
  const [filter, setFilter] = useState<FilterType>("all");

  const { data: contracts = [], isLoading } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const filteredContracts = contracts.filter((contract) => {
    if (filter === "all") return true;
    if (filter === "active") return contract.status === "Active" || contract.status === "Signed";
    if (filter === "completed") return contract.status === "Completed";
    return true;
  });

  const getInvoiceStatus = (contractId: number) => {
    const invoice = invoices.find(i => i.contractId === contractId);
    return invoice?.status;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const filters: { value: FilterType; label: string }[] = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "completed", label: "Completed" },
  ];

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="glass-header sticky top-0 z-40">
        <div className="px-4 py-4">
          <h1 className="text-xl font-bold mb-4">Contracts</h1>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
            {filters.map((f) => (
              <Button
                key={f.value}
                variant={filter === f.value ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(f.value)}
                className={`flex-shrink-0 rounded-full ${filter === f.value ? "gradient-btn text-white" : ""}`}
                data-testid={`filter-${f.value}`}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>
      </header>

      <main className="px-4 py-6 animate-fade-in">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="glass-card border-0">
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <div className="flex gap-2 pt-2">
                    <Skeleton className="h-6 w-16 rounded-full" />
                    <Skeleton className="h-6 w-20 rounded-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredContracts.length > 0 ? (
          <div className="space-y-4">
            {filteredContracts.map((contract) => {
              const invoiceStatus = getInvoiceStatus(contract.id);

              return (
                <Link key={contract.id} href={`/contracts/${contract.id}`}>
                  <Card
                    className="glass-card border-0 hover-elevate active-elevate-2 cursor-pointer"
                    data-testid={`card-contract-${contract.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{contract.contractName}</p>
                          <p className="text-sm text-muted-foreground truncate">
                            {contract.brandName}
                          </p>
                        </div>
                        <StatusBadge status={contract.status} />
                      </div>

                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{formatDate(contract.startDate)} - {formatDate(contract.endDate)}</span>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-white/10">
                        <div className="flex items-center gap-2 flex-wrap">
                          {contract.exclusive && (
                            <Badge
                              variant="secondary"
                              className="bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400 no-default-hover-elevate no-default-active-elevate"
                            >
                              <Shield className="w-3 h-3 mr-1" />
                              Exclusive
                            </Badge>
                          )}
                          {contract.proofFileName && (
                            <Badge
                              variant="secondary"
                              className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 no-default-hover-elevate no-default-active-elevate"
                            >
                              <FileCheck className="w-3 h-3 mr-1" />
                              Proof
                            </Badge>
                          )}
                          {invoiceStatus && (
                            <Badge
                              variant="secondary"
                              className={`no-default-hover-elevate no-default-active-elevate ${
                                invoiceStatus === "Paid"
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                                  : "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400"
                              }`}
                            >
                              {invoiceStatus}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-primary">
                            ₹{contract.contractValue.toLocaleString()}
                          </span>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : (
          <Card className="glass-card border-0">
            <CardContent className="py-12 text-center">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mx-auto mb-4">
                <FileText className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">No contracts yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {filter === "all"
                  ? "Accept a deal to create your first contract"
                  : `No ${filter} contracts found`}
              </p>
              {filter !== "all" && (
                <Button
                  variant="outline"
                  onClick={() => setFilter("all")}
                  data-testid="button-view-all"
                >
                  View All Contracts
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
