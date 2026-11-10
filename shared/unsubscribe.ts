/**
 * The unsubscribe link a campaign email carries, the pure half: its wording and its shape. No secret and no crypto
 * here (the server signs and checks the token: server/sales/unsubscribe.ts), so the page code may import this.
 *
 * The line's wording is deliberate: like the opt-out line (shared/campaign.ts), it must not itself read as an opt-out
 * to the reply rules, or a friendly reply that quotes our footer would put that person on the do-not-contact list.
 */
export const UNSUBSCRIBE_PATH = "/u/";
export const UNSUBSCRIBE_LINE_PREFIX = "To stop these emails: ";
export const unsubscribeLine = (url: string) => `${UNSUBSCRIBE_LINE_PREFIX}${url}`;
/** A token as it appears in the link: "<message id>.<signature>", nothing else. */
export const TOKEN_SHAPE = /^(\d{1,12})\.([A-Za-z0-9_-]{32})$/;
/** "asha@organics.example" → "a***@organics.example": enough for the person to recognise their address, not enough to harvest it. */
export function maskEmail(address: string | null | undefined): string {
  const m = String(address ?? "").trim().match(/^([^@\s])[^@\s]*@([^@\s]+)$/);
  return m ? `${m[1]}***@${m[2]}` : "your address";
}
