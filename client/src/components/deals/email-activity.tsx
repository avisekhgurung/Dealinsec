/**
 * A deal's email story, on the deal page: the lead it was won from, the AI Outbound prospect behind it, its email
 * conversations, and the email part of its timeline (sent, replied, opted out, labels, stage changes). Built from ids
 * and labels only; reading a conversation opens it in the inbox. Shown only for a deal that came from a lead.
 */
import { Link } from "wouter";
import { Loader2, Mail, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDealEmailActivity } from "@/lib/inbox";
import { dateLabel, stageLabel } from "@/lib/leads";
import { cn } from "@/lib/utils";
import { httpErrorKind } from "@shared/http-error-kind";
import { THREAD_STATUS_TEXT } from "@shared/inbox-view";
import { ACTIVITY_LABEL, activityActor, activityDetail, activityThreadId, conversationHref } from "@shared/activity-text";

const linkCls = "text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400";

export function DealEmailActivity({ dealId, locale }: { dealId: number; locale?: string }) {
  const q = useDealEmailActivity(dealId);
  // Not a deal from a lead, or this person may not see leads: nothing to show, and no empty box either.
  if (q.isError && ["not_found", "forbidden"].includes(httpErrorKind(q.error))) return null;
  if (q.data && !q.data.lead) return null;
  return (
    <Card className="glass-card border-0" data-testid="deal-email-activity">
      <CardContent className="space-y-4 p-5 lg:p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4 text-primary" aria-hidden />Email activity</h3>
          {q.data?.lead && <Link href={`/leads/${q.data.lead.id}`} className={cn("text-xs font-medium", linkCls)}>Open the lead</Link>}
        </div>

        {q.isLoading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading email activity"><Skeleton className="h-12 w-full" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
        ) : q.isError || !q.data ? (
          <div className="flex flex-wrap items-center gap-2 text-sm" role="alert">
            Email activity couldn't be loaded.
            <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Try again</Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Won from the lead <span className="font-medium text-foreground">{q.data.lead!.company}</span>
              {q.data.prospect && <> · found by AI Outbound ({q.data.prospect.domain})</>}
            </p>

            {q.data.conversations.length > 0 && (
              <ul className="space-y-2" aria-label="Email conversations">
                {q.data.conversations.map((c) => (
                  <li key={c.threadId}>
                    <Link href={conversationHref(c.threadId)} className="flex items-start gap-3 rounded-lg border bg-background/60 p-3 transition-colors hover:bg-muted/50" data-testid="deal-conversation">
                      <MessagesSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.subject || "(no subject)"}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {THREAD_STATUS_TEXT[c.status]?.label ?? c.status} · {c.replies} repl{c.replies === 1 ? "y" : "ies"}{c.lastMessageAt ? ` · ${dateLabel(c.lastMessageAt, locale)}` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {q.data.events.length ? (
              <ol className="space-y-3 border-l border-border pl-4" aria-label="Email timeline, newest first">
                {q.data.events.map((e) => {
                  const detail = activityDetail(e.kind, e.data, stageLabel);
                  const thread = activityThreadId(e.data);
                  return (
                    <li key={e.id} className="relative" data-testid={`deal-event-${e.kind}`}>
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-border" />
                      <p className="text-sm font-medium">{ACTIVITY_LABEL[e.kind] ?? e.kind.replace(/_/g, " ")}</p>
                      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
                      <p className="text-[11px] text-muted-foreground">
                        {activityActor(e)} · {dateLabel(e.at, locale)}
                        {thread && <> · <Link href={conversationHref(thread)} className={linkCls}>View conversation</Link></>}
                      </p>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="deal-email-empty">No email activity was recorded for this lead.</p>
            )}
            {!q.data.inboxAvailable && <p className="text-xs text-muted-foreground">Email conversations appear here once Gmail reply sync is set up.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
