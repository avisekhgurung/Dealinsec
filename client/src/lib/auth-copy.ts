/**
 * What the sign-in, sign-up and password pages say when a request fails. apiRequest throws "<status>: <body>"
 * (lib/queryClient.ts), which must never reach a person as-is. Pure, so it is unit-tested.
 *
 * - A failed fetch (no status) is the connection, not the account.
 * - A wrong email or password on log in gets one message, whichever was wrong, so it reveals nothing about accounts.
 * - A 400 or 429 keeps the server's own sentence: those are written for people ("Password must be at least
 *   6 characters", "Too many sign-in attempts…").
 * - Anything else is our fault, said plainly.
 */
export const NETWORK_ERROR = "Couldn't reach DealInSec. Check your internet connection and try again.";
export const WRONG_CREDENTIALS = "That email or password doesn't match an account. Please try again.";
export const SERVER_ERROR = "Something went wrong on our side. Please try again in a moment.";
export const RESET_LINK_INVALID = "This reset link is invalid or has expired. Request a new one.";

export type AuthAction = "login" | "signup" | "forgot" | "reset";

export function authErrorMessage(err: unknown, action: AuthAction): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const match = message.match(/^(\d{3}):\s*([\s\S]*)$/);
  if (!match) return NETWORK_ERROR;
  const status = Number(match[1]);
  let serverMessage = "";
  try {
    const body = JSON.parse(match[2]);
    if (typeof body?.message === "string") serverMessage = body.message;
  } catch {
    // Not JSON: a proxy or gateway page, never shown.
  }
  if (action === "login" && status === 401) return WRONG_CREDENTIALS;
  if (action === "reset" && status === 400 && !serverMessage) return RESET_LINK_INVALID;
  if ((status === 400 || status === 429) && serverMessage) return serverMessage;
  return SERVER_ERROR;
}
