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
  code: "NO_CREDITS" | "UPGRADE_REQUIRED" | null;
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
      code: body?.code === "NO_CREDITS" || body?.code === "UPGRADE_REQUIRED" ? body.code : null,
      feature: body?.feature,
      error: body?.error,
      credits: body?.credits,
    };
  } catch {
    return { status, code: null };
  }
}

/** True when the error should open the upgrade modal rather than a toast. */
export function isUpgradeError(parsed: ParsedApiError): boolean {
  return parsed.code === "NO_CREDITS" || parsed.code === "UPGRADE_REQUIRED";
}
