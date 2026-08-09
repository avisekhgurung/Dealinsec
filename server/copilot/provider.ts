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
}

export interface AIProvider {
  readonly name: string;
  chat(messages: ChatMessage[], tools: readonly any[]): Promise<ChatResult>;
}

class DeepSeekProvider implements AIProvider {
  readonly name = "deepseek";

  isConfigured(): boolean {
    return !!process.env.DEEPSEEK_API_KEY;
  }

  async chat(messages: ChatMessage[], tools: readonly any[]): Promise<ChatResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch(
        (process.env.DEEPSEEK_URL || "https://api.deepseek.com") + "/chat/completions",
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          },
          body: JSON.stringify({
            model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
            messages,
            tools: tools.length ? tools : undefined,
            temperature: 0.3,
            max_tokens: 700,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`deepseek ${res.status}: ${body.slice(0, 200)}`);
      }
      const data: any = await res.json();
      const msg = data?.choices?.[0]?.message ?? {};
      const toolCalls = (msg.tool_calls ?? []).map((t: any) => {
        let parsed: any = {};
        try {
          parsed = JSON.parse(t.function?.arguments || "{}");
        } catch {
          parsed = { __invalid: true };
        }
        return { id: t.id, name: t.function?.name ?? "", arguments: parsed };
      });
      return { content: msg.content ?? null, toolCalls };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const aiProvider = new DeepSeekProvider();
export const copilotConfigured = () => aiProvider.isConfigured();
