/**
 * Why a record didn't load, in the three ways a detail screen can say it
 * honestly: it isn't there, you may not open it, or loading failed.
 *
 * Pure. Reads the message the client's query function throws, which is
 * `${status}: ${body}` (client/src/lib/queryClient.ts). Anything without a
 * status — a dropped connection, a JSON parse error — is a failure to load,
 * never "not found": saying a record doesn't exist when we simply couldn't
 * reach the server would be a lie.
 */
export type HttpErrorKind = "not_found" | "forbidden" | "failed";

/** The HTTP status at the start of a thrown query error, or null if it has none. */
export function httpErrorStatus(err: unknown): number | null {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const m = /^(\d{3}):/.exec(message);
  return m ? Number(m[1]) : null;
}

export function httpErrorKind(err: unknown): HttpErrorKind {
  const status = httpErrorStatus(err);
  if (status === 404) return "not_found";
  if (status === 403) return "forbidden";
  return "failed";
}
