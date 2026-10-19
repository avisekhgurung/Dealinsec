/**
 * What a document detail screen (agreement, quotation, invoice) shows before
 * its record arrives, and when it can't show it.
 *
 *   - DetailSkeleton has the shape of the page that is coming — the same
 *     columns, the same document sheet — so nothing jumps when it lands.
 *   - DetailUnavailable says which of three things happened, because they
 *     need different next steps: the record isn't there, the member's role
 *     may not open it, or it simply didn't load (nothing changed; try again).
 *     Classify a query error with httpErrorKind (shared/http-error-kind.ts).
 */
import { Link } from "wouter";
import { motion } from "framer-motion";
import { FileQuestion, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadError } from "@/components/load-error";
import { fadeIn, useCalmMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { HttpErrorKind } from "@shared/http-error-kind";

/* ── Skeleton ───────────────────────────────────────────────────────────── */

function StepperSkeleton() {
  return (
    <div className="flex items-center gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-1 items-center gap-2">
          <div className="flex flex-col items-center gap-1">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-3 w-12" />
          </div>
          {i < 3 && <Skeleton className="h-0.5 flex-1" />}
        </div>
      ))}
    </div>
  );
}

/** One A4-ish sheet: a header band, a few lines, a table, a total. */
export function DocumentSheetSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border/60 bg-card p-6 space-y-6", className)} aria-hidden>
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="space-y-2 flex flex-col items-end">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-5/6" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-48" />
      </div>
    </div>
  );
}

function BlockSkeleton({ tall }: { tall?: boolean }) {
  return (
    <Card className="glass-card border-0">
      <CardContent className="p-5 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        {tall && <Skeleton className="h-40 w-full rounded-xl" />}
      </CardContent>
    </Card>
  );
}

/**
 * The page's body while its record loads. `split` is the 2/3 main + 1/3 rail
 * detail layout (agreement); `document` is one centred sheet (quotation,
 * invoice). Render it where the page's own <main> content goes.
 */
export function DetailSkeleton({
  what,
  layout = "split",
  stepper = true,
  mainBlocks = 2,
  railBlocks = 2,
  className,
}: {
  /** Read to screen readers: "Loading agreement…". */
  what: string;
  layout?: "split" | "document";
  stepper?: boolean;
  /** Cards under the title card in the main column (split only). */
  mainBlocks?: number;
  /** Cards in the right rail (split only); 0 drops the rail. */
  railBlocks?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={cn("space-y-6 lg:space-y-8", className)} data-testid="detail-skeleton">
      <span className="sr-only">Loading {what}…</span>
      {stepper && <div aria-hidden><StepperSkeleton /></div>}
      {layout === "document" ? (
        <DocumentSheetSkeleton />
      ) : (
        <div className="lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start" aria-hidden>
          <div className={cn("space-y-6", railBlocks > 0 && "lg:col-span-2", railBlocks === 0 && "lg:col-span-3")}>
            {/* Title card: name, party, status badge, three figures. */}
            <Card className="glass-card border-0">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-6 w-2/3" />
                    <Skeleton className="h-4 w-1/3" />
                  </div>
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  <Skeleton className="h-16 rounded-xl" />
                  <Skeleton className="h-16 rounded-xl" />
                  <Skeleton className="h-16 rounded-xl col-span-2 lg:col-span-1" />
                </div>
              </CardContent>
            </Card>
            {Array.from({ length: mainBlocks }, (_, i) => <BlockSkeleton key={i} tall={i === 0} />)}
          </div>
          {railBlocks > 0 && (
            <div className="lg:col-span-1 space-y-6 mt-6 lg:mt-0">
              {Array.from({ length: railBlocks }, (_, i) => <BlockSkeleton key={i} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Unavailable ────────────────────────────────────────────────────────── */

/**
 * The record didn't arrive. `what` is the record's noun ("agreement"); the
 * copy differs by kind, because "not found" after a dropped connection would
 * tell someone their agreement is gone when we simply couldn't reach it.
 */
export function DetailUnavailable({
  kind,
  what,
  backHref,
  backLabel,
  onRetry,
  retrying,
}: {
  kind: HttpErrorKind;
  what: string;
  backHref: string;
  backLabel?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const calm = useCalmMotion();
  const back = (
    <Link href={backHref}>
      <Button variant={kind === "failed" ? "ghost" : "outline"} size="sm" className={kind === "failed" ? "" : "mt-4"}>
        {backLabel ?? "Go back"}
      </Button>
    </Link>
  );

  return (
    <motion.div variants={fadeIn} initial={calm ? false : "hidden"} animate="visible" data-testid={`detail-unavailable-${kind}`}>
      <Card className="glass-card border-0">
        <CardContent className="p-0">
          {kind === "failed" ? (
            <>
              <LoadError what={`this ${what}`} onRetry={onRetry} retrying={retrying} />
              <div className="-mt-6 pb-6 text-center">{back}</div>
            </>
          ) : (
            <div role="alert" className="px-6 py-14 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                {kind === "forbidden"
                  ? <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
                  : <FileQuestion className="h-6 w-6 text-muted-foreground" aria-hidden />}
              </div>
              <p className="font-semibold">
                {kind === "forbidden" ? `You can't open this ${what}` : `${what.charAt(0).toUpperCase()}${what.slice(1)} not found`}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                {kind === "forbidden"
                  ? "Your role doesn't include access to this. Ask your workspace owner if you need it."
                  : "It may have been deleted, or the link may be incorrect. Go back to the list to find it."}
              </p>
              {back}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
