import { Badge } from "@/components/ui/badge";

type StatusType = "Pending" | "Active" | "Completed" | "Signed" | "Paid" | "Unpaid";

const statusStyles: Record<StatusType, string> = {
  Pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  Active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  Completed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  Signed: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  Paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  Unpaid: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const statusKey = status as StatusType;
  const style = statusStyles[statusKey] || statusStyles.Pending;
  
  return (
    <Badge 
      variant="secondary"
      className={`${style} text-xs font-medium uppercase tracking-wide px-3 py-1 rounded-full no-default-hover-elevate no-default-active-elevate ${className}`}
    >
      {status}
    </Badge>
  );
}
