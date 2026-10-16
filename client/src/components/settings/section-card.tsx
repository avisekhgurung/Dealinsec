/**
 * One card shape for every Settings section: a heading, one line on what it is for, its actions on the right (below
 * on phones), then the content. Permission notes use PermissionNote so "Only the Owner or an Admin can …" reads the
 * same everywhere.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function SettingsSection({
  title, description, icon: Icon, action, children, className, contentClassName, id, testId,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
  id?: string;
  testId?: string;
}) {
  return (
    <Card className={cn("glass-card", className)} id={id} data-testid={testId}>
      <CardContent className={cn("space-y-4 p-5 lg:p-6", contentClassName)}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              {Icon && <Icon className="h-5 w-5 shrink-0" aria-hidden />}
              {title}
            </h2>
            {description && <div className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</div>}
          </div>
          {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/** What this member can't change here, and who can. */
export function PermissionNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return <p className="text-xs text-muted-foreground" data-testid={testId}>{children}</p>;
}

/** A card-shaped placeholder while a section's data loads. */
export function SectionSkeleton({ lines = 3, testId }: { lines?: number; testId?: string }) {
  return (
    <Card className="glass-card" aria-busy="true" data-testid={testId}>
      <CardContent className="space-y-3 p-5 lg:p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full max-w-md" />
        {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
      </CardContent>
    </Card>
  );
}
