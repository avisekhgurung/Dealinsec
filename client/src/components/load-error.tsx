/**
 * What a page shows when its data didn't load: never an empty list (that would say "you have nothing" when we simply
 * don't know), never an endless skeleton. One plain sentence, and a way to try again.
 */
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LoadError({ what, onRetry, retrying, compact }: { what: string; onRetry?: () => void; retrying?: boolean; compact?: boolean }) {
  return (
    <div role="alert" className={compact ? "flex flex-wrap items-center gap-3 px-4 py-4 text-sm" : "px-6 py-14 text-center"} data-testid="load-error">
      {!compact && (
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10">
          <AlertTriangle className="h-6 w-6 text-amber-600" aria-hidden />
        </div>
      )}
      {compact && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />}
      <div className={compact ? "min-w-0 flex-1" : ""}>
        <p className="font-semibold">Couldn't load {what}</p>
        <p className={compact ? "text-muted-foreground" : "mx-auto mt-1 max-w-sm text-sm text-muted-foreground"}>
          Nothing was changed. Check your connection, then try again.
        </p>
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" className={compact ? "" : "mt-4"} onClick={onRetry} disabled={retrying}>
          <RotateCw className={`mr-1.5 h-4 w-4 ${retrying ? "animate-spin" : ""}`} aria-hidden />Try again
        </Button>
      )}
    </div>
  );
}
