/**
 * Parse errors thrown by apiRequest / throwIfResNotOk, whose message format is
 * `"<status>: <body text>"` (see lib/queryClient.ts). The subscription gates
 * return machine-readable JSON bodies:
 *   402 { code: "NO_CREDITS", feature: "deals", credits: {...} }
 *   403 { code: "UPGRADE_REQUIRED", feature: "agreements" | ... }
 * Mutations' onError handlers use this to decide whether to open the
 * UpgradeModal instead of a generic toast.
 */

export interface ParsedApiError {
  status: number | null;
  /** CURRENCY_CHANGED (409): a money write converted in a currency the org no
   *  longer uses. Nothing was saved; the org row has already been refetched
   *  (lib/queryClient.ts), so the screen should show `error` and let the user
   *  re-check the amount rather than retry for them. */
  code: "NO_CREDITS" | "UPGRADE_REQUIRED" | "CURRENCY_CHANGED" | null;
  feature?: string;
  error?: string;
  credits?: { monthly: number; purchased: number; resetsAt: string | null };
}

export function parseApiError(err: unknown): ParsedApiError {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const match = message.match(/^(\d{3}):\s*([\s\S]*)$/);
  if (!match) return { status: null, code: null };
  const status = parseInt(match[1], 10);
  try {
    const body = JSON.parse(match[2]);
    return {
      status,
      code: body?.code === "NO_CREDITS" || body?.code === "UPGRADE_REQUIRED" || body?.code === "CURRENCY_CHANGED"
        ? body.code
        : null,
      feature: body?.feature,
      error: body?.error,
      credits: body?.credits,
    };
  } catch {
    return { status, code: null };
  }
}

/** The toast for a CURRENCY_CHANGED refusal, or null for any other error. Kept
 *  here so every money form words it the same way. */
export function currencyChangedToast(err: unknown): { title: string; description: string } | null {
  const parsed = parseApiError(err);
  if (parsed.code !== "CURRENCY_CHANGED") return null;
  return {
    title: "Your organisation's currency changed",
    description: parsed.error || "Nothing was saved. Please check the amount and try again.",
  };
}

/** True when the error should open the upgrade modal rather than a toast. */
export function isUpgradeError(parsed: ParsedApiError): boolean {
  return parsed.code === "NO_CREDITS" || parsed.code === "UPGRADE_REQUIRED";
}
