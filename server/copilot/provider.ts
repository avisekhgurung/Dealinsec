/**
 * DealinSec Copilot — model provider abstraction.
 *
 * AIService is provider-agnostic; DeepSeek is the first implementation
 * (OpenAI-compatible chat-completions with function calling — same endpoint
 * family the free invoice tool in server/ai.ts already uses). Swapping or
 * adding a provider means implementing `chat()` — nothing else in the
 * Copilot changes. The API key never leaves the server.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ChatResult {
  content: string | null;
  toolCalls: { id: string; name: string; arguments: any }[];
  /** Token counts when the provider reports them (DeepSeek does). */
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ChatOptions {
  /** Abort the request (a client that disconnected, a run past its budget). */
  signal?: AbortSignal;
  /** Output cap; the Copilot's default is 700. */
  maxTokens?: number;
  /** Use this model for this one call instead of the configured one (a small, fast job that a reasoning model does badly). */
  model?: string;
}

export type ProviderErrorCode = "timeout" | "rate_limited" | "upstream" | "invalid_response" | "aborted";

/** A provider failure the caller can tell apart without parsing a message. */
export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Full chat-completions URL, tolerant of base-vs-endpoint env values. */
function endpointUrl(): string {
  const raw = (process.env.DEEPSEEK_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  return raw.endsWith("/chat/completions") ? raw : `${raw}/chat/completions`;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  chat(messages: ChatMessage[], tools: readonly any[], opts?: ChatOptions): Promise<ChatResult>;
}

const TIMEOUT_MS = 45_000;
const RETRY_DELAY_MS = 600;

class DeepSeekProvider implements AIProvider {
  readonly name = "deepseek";

  get model(): string {
    return process.env.DEEPSEEK_MODEL || "deepseek-chat";
  }

  isConfigured(): boolean {
    return !!process.env.DEEPSEEK_API_KEY;
  }

  /** One retry, only for a rate limit or a 5xx — never for a timeout or an
   *  abort (the user has already waited, or has gone), and never for a 4xx
   *  that retrying cannot fix. */
  async chat(messages: ChatMessage[], tools: readonly any[], opts: ChatOptions = {}): Promise<ChatResult> {
    try {
      return await this.once(messages, tools, opts);
    } catch (err) {
      const retryable = err instanceof ProviderError && (err.code === "rate_limited" || (err.code === "upstream" && (err.status ?? 500) >= 500));
      if (!retryable || opts.signal?.aborted) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return this.once(messages, tools, opts);
    }
  }

  private async once(messages: ChatMessage[], tools: readonly any[], opts: ChatOptions): Promise<ChatResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), TIMEOUT_MS);
    const onAbort = () => controller.abort("aborted");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    if (opts.signal?.aborted) onAbort();
    try {
      let res: Response;
      try {
        res = await fetch(
          // DEEPSEEK_URL is set in production as the FULL endpoint (that's the
          // convention server/ai.ts established); accept a bare base too, so
          // either form works and we never double-append the path.
          endpointUrl(),
          {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
              model: opts.model || this.model,
              messages,
              tools: tools.length ? tools : undefined,
              temperature: 0.3,
              max_tokens: opts.maxTokens ?? 700,
            }),
          },
        );
      } catch (err) {
        if (controller.signal.aborted) {
          throw new ProviderError(controller.signal.reason === "timeout" ? "timeout" : "aborted", "deepseek request did not complete");
        }
        throw new ProviderError("upstream", `deepseek unreachable: ${(err as Error)?.message ?? "network error"}`.slice(0, 200), 503);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProviderError(res.status === 429 ? "rate_limited" : "upstream", `deepseek ${res.status}: ${body.slice(0, 200)}`, res.status);
      }
      const data: any = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.choices)) throw new ProviderError("invalid_response", "deepseek returned an unreadable response");
      const msg = data.choices[0]?.message ?? {};
      const toolCalls = (msg.tool_calls ?? []).map((t: any) => {
        let parsed: any = {};
        try {
          parsed = JSON.parse(t.function?.arguments || "{}");
        } catch {
          parsed = { __invalid: true };
        }
        return { id: t.id, name: t.function?.name ?? "", arguments: parsed };
      });
      const u = data.usage;
      return {
        content: msg.content ?? null,
        toolCalls,
        usage: u ? { inputTokens: Number(u.prompt_tokens) || 0, outputTokens: Number(u.completion_tokens) || 0 } : undefined,
      };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
}

export const aiProvider = new DeepSeekProvider();
export const copilotConfigured = () => aiProvider.isConfigured();
