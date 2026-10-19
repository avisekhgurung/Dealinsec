/**
 * Hands the landing demo's "who do you want as clients?" sentence to Client Radar after signup, the same way
 * deal-prefill.ts hands over a demo deal: sessionStorage (this tab only), read once and cleared. Every access is
 * wrapped: blocked storage only means Client Radar opens empty.
 */
export const OUTBOUND_PREFILL_KEY = "dis_outbound_prefill";

export function setOutboundPrefill(request: string): void {
  try { sessionStorage.setItem(OUTBOUND_PREFILL_KEY, request.slice(0, 500)); } catch { /* Client Radar just opens empty */ }
}

export function hasPendingOutboundPrefill(): boolean {
  try { return !!sessionStorage.getItem(OUTBOUND_PREFILL_KEY); } catch { return false; }
}

/** The waiting sentence, removed as it is read (so a reload doesn't fill the box again). */
export function takeOutboundPrefill(): string | null {
  try {
    const v = sessionStorage.getItem(OUTBOUND_PREFILL_KEY);
    sessionStorage.removeItem(OUTBOUND_PREFILL_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}
