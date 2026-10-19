/**
 * DealinSec Copilot — model provider abstraction.
 *
 * AIService is provider-agnostic; DeepSeek is the first implementation
 * (OpenAI-compatible chat-completions with function calling — same endpoint
 * family the free invoice tool in server/ai.ts already uses). Swapping or
 * adding a provider means implementing `chat()` — nothing else in the
 * Copilot changes. The API key never leaves the server.
 */
import { createSseParser } from "@shared/sse";

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
  /** Stream the reply: called with each piece of the answer's text as it arrives (never the model's reasoning, never
   *  tool-call arguments). The promise still resolves to the complete result. Without it the call is not streamed. */
  onText?: (delta: string) => void;
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
/** A streamed reply may take longer than one answer in one piece, as long as text keeps arriving. */
const STREAM_MAX_MS = 180_000;
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
    // Once a streamed reply has shown text, a retry would show it twice: only a call that showed nothing is retried.
    let shown = false;
    const run = opts.onText ? { ...opts, onText: (d: string) => { shown = true; opts.onText!(d); } } : opts;
    try {
      return await this.once(messages, tools, run);
    } catch (err) {
      const retryable = err instanceof ProviderError && (err.code === "rate_limited" || (err.code === "upstream" && (err.status ?? 500) >= 500));
      if (!retryable || opts.signal?.aborted || shown) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return this.once(messages, tools, opts);
    }
  }

  private async once(messages: ChatMessage[], tools: readonly any[], opts: ChatOptions): Promise<ChatResult> {
    const controller = new AbortController();
    // Streaming: an idle timeout (reset by every chunk) under an overall cap. Otherwise one timeout for the answer.
    let timer = setTimeout(() => controller.abort("timeout"), TIMEOUT_MS);
    const cap = opts.onText ? setTimeout(() => controller.abort("timeout"), STREAM_MAX_MS) : null;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort("timeout"), TIMEOUT_MS); };
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
              ...(opts.onText ? { stream: true, stream_options: { include_usage: true } } : {}),
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
      if (opts.onText) {
        try {
          return await readChatStream(res, opts.onText, bump);
        } catch (err) {
          if (err instanceof ProviderError) throw err;
          if (controller.signal.aborted) throw new ProviderError(controller.signal.reason === "timeout" ? "timeout" : "aborted", "deepseek stream did not complete");
          throw new ProviderError("upstream", "deepseek stream broke off", 503);
        }
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
      if (cap) clearTimeout(cap);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * Read an OpenAI-compatible streamed chat completion (Server-Sent Events): text deltas go to `onText` as they arrive,
 * tool calls are assembled from their fragments by index, and usage comes from the final chunk. Malformed frames are
 * skipped; a stream that ends with neither text nor tool calls is an unreadable response.
 */
export async function readChatStream(res: Response, onText: (delta: string) => void, onChunk: () => void = () => {}): Promise<ChatResult> {
  if (!res.body) throw new ProviderError("invalid_response", "deepseek returned no stream");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  let sawFrame = false;
  const calls: { id?: string; name: string; args: string }[] = [];
  const parser = createSseParser((m) => {
    if (m.data === "[DONE]") return;
    let j: any;
    try { j = JSON.parse(m.data); } catch { return; }
    sawFrame = true;
    if (j?.usage) usage = { inputTokens: Number(j.usage.prompt_tokens) || 0, outputTokens: Number(j.usage.completion_tokens) || 0 };
    const d = j?.choices?.[0]?.delta;
    if (!d) return;
    if (typeof d.content === "string" && d.content) { content += d.content; onText(d.content); }
    for (const t of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
      const i = Number.isInteger(t?.index) ? t.index : calls.length;
      calls[i] ??= { name: "", args: "" };
      if (t.id) calls[i].id = t.id;
      if (t.function?.name) calls[i].name += t.function.name;
      if (t.function?.arguments) calls[i].args += t.function.arguments;
    }
  });
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    onChunk();
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.flush();
  if (!sawFrame) throw new ProviderError("invalid_response", "deepseek returned an unreadable stream");
  const toolCalls = calls.filter(Boolean).map((c, i) => {
    let parsed: any = {};
    try { parsed = JSON.parse(c.args || "{}"); } catch { parsed = { __invalid: true }; }
    return { id: c.id ?? `call_${i}`, name: c.name, arguments: parsed };
  });
  return { content: content || null, toolCalls, usage };
}

export const aiProvider = new DeepSeekProvider();
export const copilotConfigured = () => aiProvider.isConfigured();
