/** Client side of the outreach channels (server/channels/routes.ts). Types mirror the server's views. */
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { ChannelStatus, ShortChannel } from "@shared/channels";

export const CHANNELS_STATUS_URL = "/api/channels/status";
export const channelMessagesUrl = (leadId: number) => `/api/channels/leads/${leadId}/messages`;
export const channelDraftUrl = (leadId: number) => `/api/channels/leads/${leadId}/draft`;
export const optInUrl = (leadId: number, out = false) => `/api/channels/leads/${leadId}/whatsapp/${out ? "opt-out" : "opt-in"}`;
export const channelMessageUrl = (id: number, action?: string) => `/api/channels/messages/${id}${action ? `/${action}` : ""}`;
export const WHATSAPP_URL = "/api/integrations/whatsapp";
export const WHATSAPP_TEMPLATES_URL = "/api/integrations/whatsapp/templates";

export interface ChannelMessage {
  id: number; leadId: number; channel: ShortChannel; kind: string; kindLabel: string; direction: "out" | "in"; body: string | null; bodyHash: string | null;
  to: string | null; template: { name: string; language: string; params: string[] } | null;
  status: "draft" | "approved" | "sending" | "sent" | "failed" | "uncertain" | "cancelled" | "received"; statusLabel: string;
  sentVia: "api" | "manual" | null; delivery: "delivered" | "read" | null; errorCode: string | null; edited: boolean; createdBy: string;
  createdAt: string; approvedAt: string | null; sentAt: string | null; deliveredAt: string | null; readAt: string | null; repliedAt: string | null;
}
export interface WhatsappContact { phone: string; optedIn: boolean; optInSource: string | null; optedInAt: string | null; optedOut: boolean; windowOpenUntil: string | null }
export interface WhatsappTemplate { name: string; language: string; category: string; body: string; params: number }
export interface WhatsappStatus { configured: boolean; reason: string | null; canManage: boolean; connection: { status: string; displayPhone: string | null; verifiedName: string | null; connectedAt: string; lastErrorCode: string | null } | null; webhookPath: string }

export const useChannelStatuses = () => useQuery<{ channels: ChannelStatus[] }>({ queryKey: [CHANNELS_STATUS_URL], retry: false, staleTime: 30_000 });
export const useChannelMessages = (leadId: number) => useQuery<{ messages: ChannelMessage[]; whatsappContacts: WhatsappContact[] }>({ queryKey: [channelMessagesUrl(leadId)], retry: false });
export const useWhatsappStatus = () => useQuery<WhatsappStatus>({ queryKey: [WHATSAPP_URL], retry: false });

export const refreshChannels = (leadId?: number) => Promise.all([
  queryClient.invalidateQueries({ queryKey: [CHANNELS_STATUS_URL] }),
  leadId ? queryClient.invalidateQueries({ queryKey: [channelMessagesUrl(leadId)] }) : Promise.resolve(),
]);

/** WhatsApp's own "click to chat" link: opens WhatsApp with the text filled in; the person presses send. */
export const waMeUrl = (phone: string, text: string) => `https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`;
