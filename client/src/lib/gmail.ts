/** Your connected Gmail: status, connect (leaves for Google), check, disconnect. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { GmailStatusView, ResolveDecision, SendOutcome, SendView, VerifyResult } from "@shared/gmail-connect";

export const GMAIL_URL = "/api/integrations/gmail";

export const useGmailStatus = () => useQuery<GmailStatusView>({ queryKey: [GMAIL_URL], retry: false });

const put = (s: GmailStatusView) => queryClient.setQueryData([GMAIL_URL], s);

/** Asks the server for Google's consent URL (bound to this session), then goes there. */
export const useConnectGmail = () => useMutation({
  mutationFn: async () => {
    const r: { url: string } = await (await apiRequest("POST", `${GMAIL_URL}/connect`, {})).json();
    window.location.assign(r.url);
  },
});
export const useVerifyGmail = () => useMutation({
  mutationFn: async () => (await apiRequest("POST", `${GMAIL_URL}/verify`, {})).json() as Promise<{ result: VerifyResult; status: GmailStatusView }>,
  onSuccess: (r) => put(r.status),
});
export const useDisconnectGmail = () => useMutation({
  mutationFn: async () => (await apiRequest("POST", `${GMAIL_URL}/disconnect`, {})).json() as Promise<{ disconnected: number; revoked: boolean | null; status: GmailStatusView }>,
  onSuccess: (r) => put(r.status),
});

/** Reply sync: check the connected mailbox for replies now. */
export const useSyncGmail = () => useMutation({
  mutationFn: async () => (await apiRequest("POST", `${GMAIL_URL}/sync`, {})).json() as Promise<{ outcome: string; stored: number; status: GmailStatusView }>,
  onSuccess: (r) => put(r.status),
});

/* ── sending an approved message from the connected mailbox ─────────────────────────── */

export const sendStateUrl = (messageId: number) => `${GMAIL_URL}/messages/${messageId}/send`;
type SendState = { send: SendView | null };
/** A message's send state. Polled while it is in flight, so an expired lease shows up as "uncertain" on its own. */
export const useSendState = (messageId: number | null, opts: { enabled: boolean; poll: boolean }) =>
  useQuery<SendState>({ queryKey: [sendStateUrl(messageId ?? 0)], enabled: opts.enabled && !!messageId, retry: false, refetchInterval: opts.poll ? 5_000 : false });

const putSend = (messageId: number, send: SendView | null) => queryClient.setQueryData([sendStateUrl(messageId)], { send });
export const useSendFromGmail = () => useMutation({
  mutationFn: async (v: { messageId: number; bodyHash: string }) =>
    (await apiRequest("POST", sendStateUrl(v.messageId), { bodyHash: v.bodyHash })).json() as Promise<{ outcome: SendOutcome; send: SendView; reconnect: boolean }>,
  onSuccess: (r, v) => putSend(v.messageId, r.send),
});
export const useResolveSend = () => useMutation({
  mutationFn: async (v: { messageId: number; decision: ResolveDecision }) =>
    (await apiRequest("POST", `${GMAIL_URL}/messages/${v.messageId}/resolve`, { decision: v.decision })).json() as Promise<{ send: SendView; messageStatus: string }>,
  onSuccess: (r, v) => putSend(v.messageId, r.send),
});
