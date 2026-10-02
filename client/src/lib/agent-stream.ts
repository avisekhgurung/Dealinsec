/**
 * POST that answers with a Server-Sent Events stream (EventSource can't POST).
 * Events are handed to `onEvent` as they arrive; the promise settles when the
 * stream ends. A refusal before streaming starts (not signed in, daily limit,
 * agent not set up) arrives as JSON and becomes an AgentHttpError carrying the
 * server's own message, so the UI can say what actually happened.
 */
import type { AgentEvent } from "@shared/agent";
import { createSseParser } from "@shared/sse";

export class AgentHttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = "AgentHttpError";
  }
}

export async function postStream(
  path: string,
  body: unknown,
  opts: { signal?: AbortSignal; onEvent: (e: AgentEvent) => void },
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    signal: opts.signal,
    headers: { "Content-Type": "application/json", "X-DealInSec-Money": "minor" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    let message = res.statusText || "Something went wrong.";
    let code: string | undefined;
    try {
      const j = await res.json();
      message = j.error ?? j.message ?? message;
      code = j.code;
    } catch { /* not JSON */ }
    throw new AgentHttpError(res.status, message, code);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser((m) => {
    try { opts.onEvent(JSON.parse(m.data) as AgentEvent); } catch { /* a malformed frame is skipped */ }
  });
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.flush();
}
