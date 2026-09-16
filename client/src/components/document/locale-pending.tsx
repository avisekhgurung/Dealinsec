/**
 * What a document page shows until it knows which organisation's settings it
 * prints in.
 *
 * useMoney() can DISPLAY before /api/org has loaded, falling back to the
 * member's own row. For a list that is harmless; for a document it is not. An
 * invitee's row defaults to India whatever the organisation uses, so a UK
 * agency's agreement would render, and could be printed, with ₹ and the
 * Indian Contract Act clauses for the moment the org takes to load. A document
 * therefore waits for `ready` — and if the org cannot be loaded it offers a
 * retry rather than ever printing in the wrong country.
 */
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function DocLocalePending({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="px-4 py-6 space-y-4 max-w-4xl mx-auto">
        {failed ? (
          <div className="rounded-xl border border-border/60 bg-card p-6 text-center space-y-3" data-testid="doc-locale-failed">
            <p className="text-sm text-muted-foreground">
              We couldn't load your organisation's settings, so this document isn't shown yet.
            </p>
            <Button variant="outline" onClick={onRetry} data-testid="button-doc-locale-retry">
              Try again
            </Button>
          </div>
        ) : (
          <>
            <Skeleton className="h-10 w-56" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </>
        )}
      </div>
    </div>
  );
}
