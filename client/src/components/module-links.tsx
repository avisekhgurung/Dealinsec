/** Where each part of the product lives, now that the header has no menu: one tidy row on the dashboard, filtered by what the member's role may see. */
import { Link } from "wouter";
import { Briefcase, FileCheck, FileText, Receipt, Target } from "lucide-react";
import { canSeeModule } from "@shared/permissions";
import { useAuth } from "@/hooks/useAuth";

const MODULES = [
  { path: "/leads", label: "Leads", icon: Target, module: "deals" },
  { path: "/deals", label: "Deals", icon: Briefcase, module: "deals" },
  { path: "/quotations", label: "Quotations", icon: FileText, module: "quotations" },
  { path: "/contracts", label: "Agreements", icon: FileCheck, module: "agreements" },
  { path: "/invoices", label: "Invoices", icon: Receipt, module: "invoices" },
] as const;

export function ModuleLinks() {
  const { user } = useAuth();
  const items = MODULES.filter((m) => canSeeModule(user as any, m.module));
  if (!items.length) return null;
  return (
    <nav aria-label="Go to" className="flex flex-wrap gap-2" data-testid="module-links">
      {items.map(({ path, label, icon: Icon }) => (
        <Link key={path} href={path}
          data-testid={`module-${label.toLowerCase()}`}
          className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-card px-3.5 py-2 text-sm font-semibold text-foreground/85 shadow-sm transition hover:border-emerald-400/60 hover:text-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 dark:hover:text-emerald-300">
          <Icon className="h-4 w-4 text-emerald-600" />{label}
        </Link>
      ))}
    </nav>
  );
}
