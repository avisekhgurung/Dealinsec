import { Badge } from "@/components/ui/badge";
import {
  Clock,
  Zap,
  CheckCircle2,
  Shield,
  CreditCard,
  AlertCircle,
} from "lucide-react";

type StatusType = "Pending" | "Active" | "Completed" | "Signed" | "Paid" | "Unpaid" | "Draft" | "Sent";

const statusConfig: Record<StatusType, { style: string; icon: React.ElementType; dot: string }> = {
  Pending: {
    style: "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/50",
    icon: Clock,
    dot: "bg-amber-400",
  },
  Active: {
    style: "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800/50",
    icon: Zap,
    dot: "bg-emerald-400",
  },
  Completed: {
    style: "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/50",
    icon: CheckCircle2,
    dot: "bg-blue-400",
  },
  Signed: {
    style: "bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-900/20 dark:text-violet-400 dark:border-violet-800/50",
    icon: Shield,
    dot: "bg-violet-400",
  },
  Paid: {
    style: "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800/50",
    icon: CreditCard,
    dot: "bg-emerald-400",
  },
  Unpaid: {
    style: "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800/50",
    icon: AlertCircle,
    dot: "bg-rose-400",
  },
  Draft: {
    style: "bg-slate-50 text-slate-600 border border-slate-200 dark:bg-slate-900/20 dark:text-slate-400 dark:border-slate-700/50",
    icon: Clock,
    dot: "bg-slate-400",
  },
  Sent: {
    style: "bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-900/20 dark:text-sky-400 dark:border-sky-800/50",
    icon: Zap,
    dot: "bg-sky-400",
  },
};

const fallback = statusConfig.Pending;

interface StatusBadgeProps {
  status: string;
  className?: string;
  /** "default" shows dot + icon + text. "compact" shows just dot + text (smaller). */
  size?: "default" | "compact";
}

export function StatusBadge({ status, className = "", size = "default" }: StatusBadgeProps) {
  const config = statusConfig[status as StatusType] ?? fallback;
  const Icon = config.icon;

  if (size === "compact") {
    return (
      <Badge
        variant="secondary"
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 no-default-hover-elevate no-default-active-elevate ${config.style} ${className}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dot}`} />
        {status}
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 no-default-hover-elevate no-default-active-elevate ${config.style} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dot}`} />
      <Icon className="w-3 h-3 shrink-0" />
      {status}
    </Badge>
  );
}
