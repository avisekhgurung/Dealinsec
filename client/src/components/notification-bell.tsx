/**
 * App-level notifications.
 *
 * Backed by the organization's activity log, so a member sees the moments that
 * matter across the whole team: payments recorded, agreements signed, deals
 * completed, invoices raised, teammates joining.
 *
 * "Unread" is the count of entries newer than the last time this user opened
 * the panel (kept per-user in localStorage) — no extra table, and it stays
 * correct across devices-per-browser without a read-receipt round trip.
 */
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/useAuth";
import {
  Bell, IndianRupee, FileCheck, FileText, Briefcase, Users, Building2, CheckCircle2,
} from "lucide-react";

interface Activity {
  id: number;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  detail: string | null;
  createdAt: string;
}

const SEEN_KEY = "dis_notifications_seen_at";

/** Entity → icon + tint. Money events read green, everything else neutral-brand. */
function iconFor(a: Activity) {
  const isPayment = a.action.includes("payment");
  if (isPayment) return { Icon: IndianRupee, cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400" };
  switch (a.entityType) {
    case "deal": return { Icon: a.action === "completed" ? CheckCircle2 : Briefcase, cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400" };
    case "quotation": return { Icon: FileText, cls: "bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-400" };
    case "agreement": return { Icon: FileCheck, cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400" };
    case "invoice": return { Icon: IndianRupee, cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400" };
    case "member": return { Icon: Users, cls: "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400" };
    default: return { Icon: Building2, cls: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" };
  }
}

/** Where clicking a notification should take you. */
function linkFor(a: Activity): string {
  switch (a.entityType) {
    case "deal": return a.entityId ? `/deals/${a.entityId}` : "/deals";
    case "quotation": return "/quotations";
    case "agreement": return a.entityId ? `/contracts/${a.entityId}` : "/contracts";
    case "invoice": return a.entityId ? `/brand-invoices/${a.entityId}` : "/invoices";
    case "member": case "organization": return "/settings";
    default: return "/dashboard";
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function NotificationBell({ className = "" }: { className?: string }) {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<number>(() => {
    try { return parseInt(localStorage.getItem(SEEN_KEY) || "0", 10) || 0; } catch { return 0; }
  });

  const { data: activity = [] } = useQuery<Activity[]>({
    queryKey: ["/api/org/activity"],
    enabled: isAuthenticated,
    refetchInterval: 60_000,      // quiet poll — teammates' actions land within a minute
    refetchOnWindowFocus: true,
  });

  const unread = useMemo(
    () => activity.filter((a) => new Date(a.createdAt).getTime() > seenAt).length,
    [activity, seenAt],
  );

  // Opening the panel marks everything currently visible as read.
  useEffect(() => {
    if (!open || !activity.length) return;
    const newest = Math.max(...activity.map((a) => new Date(a.createdAt).getTime()));
    const t = setTimeout(() => {
      setSeenAt(newest);
      try { localStorage.setItem(SEEN_KEY, String(newest)); } catch {}
    }, 900);
    return () => clearTimeout(t);
  }, [open, activity]);

  if (!isAuthenticated) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative ${className}`}
          aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
          data-testid="notification-bell"
        >
          <Bell className="w-[18px] h-[18px]" />
          {unread > 0 && (
            <span
              className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold leading-4 text-center tabular-nums"
              data-testid="notification-count"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        collisionPadding={12}
        className="w-[360px] max-w-[calc(100vw-24px)] p-0"
        data-testid="notification-panel"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <span className="text-[11px] font-medium text-muted-foreground">{unread} new</span>
          )}
        </div>

        {activity.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Bell className="w-7 h-7 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm font-medium">You're all caught up</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Deals, agreements and payments will show up here.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[380px]">
            <div className="divide-y divide-border/50">
              {activity.slice(0, 25).map((a) => {
                const { Icon, cls } = iconFor(a);
                const isUnread = new Date(a.createdAt).getTime() > seenAt;
                return (
                  <Link key={a.id} href={linkFor(a)}>
                    <button
                      className={`w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors ${isUnread ? "bg-primary/[0.03]" : ""}`}
                      onClick={() => setOpen(false)}
                    >
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${cls}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] leading-snug">
                          <b className="font-semibold">{a.userName || "Someone"}</b>{" "}
                          {a.action} {a.entityType}
                        </span>
                        {a.detail && (
                          <span className="block text-[12px] text-muted-foreground truncate mt-0.5">
                            {a.detail}
                          </span>
                        )}
                        <span className="block text-[11px] text-muted-foreground/80 mt-1">
                          {relativeTime(a.createdAt)}
                        </span>
                      </span>
                      {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 mt-2" />}
                    </button>
                  </Link>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <div className="border-t border-border/60 p-2">
          <Link href="/settings">
            <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setOpen(false)}>
              View all activity
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
