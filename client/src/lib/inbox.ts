/** The outreach inbox's API calls (server/mail/inbox-routes.ts). */
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { leadCall } from "@/lib/leads";
import type { ConversationView, DealEmailActivity, DealFromReplyInput, DealFromReplyResult, InboxFilter, InboxList, ReplyLabel, ReviewItem } from "@shared/inbox-view";

export const INBOX_URL = "/api/outreach/inbox";
const refresh = () => queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && ((q.queryKey[0] as string).startsWith(INBOX_URL) || (q.queryKey[0] as string).startsWith("/api/leads")) });

export const useInbox = (filter: InboxFilter, q: string) => useInfiniteQuery<InboxList>({
  queryKey: [INBOX_URL, "list", filter, q],
  initialPageParam: null as string | null,
  queryFn: ({ pageParam }) => leadCall<InboxList>("GET", `${INBOX_URL}?${new URLSearchParams({ filter, ...(q ? { q } : {}), ...(pageParam ? { before: String(pageParam) } : {}) })}`),
  getNextPageParam: (last) => last.next,
  retry: false,
});
export const useReviewQueue = (enabled: boolean) => useQuery<{ items: ReviewItem[] }>({ queryKey: [`${INBOX_URL}/review`], enabled, retry: false });
export const useConversation = (threadId: number | null) => useQuery<ConversationView>({ queryKey: [`${INBOX_URL}/${threadId}`], enabled: !!threadId, retry: false });

export const useReviewDecision = () => useMutation({
  mutationFn: (v: { id: number; decision: "confirm" | "dismiss" }) => leadCall<{ state: string }>("POST", `${INBOX_URL}/messages/${v.id}/review`, { decision: v.decision }),
  onSuccess: () => { void refresh(); },
});
export const useRelabel = () => useMutation({
  mutationFn: (v: { id: number; label: ReplyLabel }) => leadCall<{ label: ReplyLabel }>("POST", `${INBOX_URL}/messages/${v.id}/label`, { label: v.label }),
  onSuccess: () => { void refresh(); },
});
export const refreshInbox = refresh;

/** "Review and create deal" on an interested conversation (once: asking again answers with the same deal). */
export const useCreateDealFromReply = () => useMutation({
  mutationFn: (v: { threadId: number } & DealFromReplyInput) => leadCall<DealFromReplyResult>("POST", `${INBOX_URL}/${v.threadId}/deal`, { ...(v.dealTitle ? { dealTitle: v.dealTitle } : {}), ...(v.dealAmount ? { dealAmount: v.dealAmount } : {}) }),
  onSuccess: () => { void refresh(); void queryClient.invalidateQueries({ queryKey: ["/api/deals"] }); },
});

/** A deal's email story: the lead it came from, its prospect, conversations and timeline (deal page). */
export const dealActivityUrl = (dealId: number) => `/api/outreach/deals/${dealId}/activity`;
export const useDealEmailActivity = (dealId: number | null) => useQuery<DealEmailActivity>({ queryKey: [dealId ? dealActivityUrl(dealId) : "no-deal"], enabled: !!dealId, retry: false });
