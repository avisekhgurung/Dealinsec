/** Test helpers: a scripted provider and quick tool builders. Never imported by server code. */
import { z } from "zod";
import { ProviderError, type AIProvider, type ChatMessage, type ChatOptions, type ChatResult } from "../copilot/provider";
import type { AgentEvent, AgentTool, AgentUser, Prepared, ToolOutcome } from "./types";

export type Step = ChatResult | Error | ((messages: ChatMessage[], opts?: ChatOptions) => ChatResult | Promise<ChatResult>);

export class FakeProvider implements AIProvider {
  readonly name = "fake";
  readonly model = "fake-1";
  calls: ChatMessage[][] = [];
  constructor(private steps: Step[]) {}
  async chat(messages: ChatMessage[], _tools: readonly any[], opts?: ChatOptions): Promise<ChatResult> {
    this.calls.push(messages.map((m) => ({ ...m })));
    const next = this.steps.shift();
    if (!next) throw new ProviderError("upstream", "script exhausted");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(messages, opts) : next;
  }
}

export const say = (content: string, usage = { inputTokens: 10, outputTokens: 5 }): ChatResult => ({ content, toolCalls: [], usage });
export const call = (name: string, args: unknown, id = `c_${name}_${Math.random().toString(36).slice(2, 7)}`): ChatResult => ({
  content: null, toolCalls: [{ id, name, arguments: args }], usage: { inputTokens: 10, outputTokens: 5 },
});
export const calls = (...cs: { name: string; args: unknown }[]): ChatResult => ({
  content: null,
  toolCalls: cs.map((c, i) => ({ id: `m${i}_${c.name}`, name: c.name, arguments: c.args })),
});

export const USER: AgentUser & Record<string, any> = { id: "u1", organizationId: "org1", orgRole: "OWNER", firstName: "Asha" };

export function readTool(over: Partial<AgentTool<any>> & { name: string }, run: (input: any) => ToolOutcome | Promise<ToolOutcome>): AgentTool<any> {
  return {
    description: "test read tool",
    risk: "READ_ONLY",
    input: z.object({ q: z.string().optional() }),
    authorize: () => null,
    run: async (_ctx, input) => run(input),
    ...over,
  };
}

export function mutationTool(
  over: Partial<AgentTool<any>> & { name: string },
  hooks: { prepare?: (input: any) => Prepared; execute?: (args: Record<string, unknown>) => ToolOutcome | Promise<ToolOutcome> } = {},
): AgentTool<any> & { executed: Record<string, unknown>[] } {
  const executed: Record<string, unknown>[] = [];
  return {
    description: "test mutation tool",
    risk: "SAFE_MUTATION",
    input: z.object({ dealId: z.number(), amount: z.number().optional() }),
    authorize: () => null,
    prepare: async (_ctx: unknown, input: any) => hooks.prepare?.(input) ?? { ok: true, args: { dealId: input.dealId }, preview: { title: `Do ${over.name}`, lines: [], effects: [] } },
    execute: async (_ctx: unknown, args: Record<string, unknown>) => {
      executed.push(args);
      return hooks.execute?.(args) ?? { ok: true, summary: `${over.name} done` };
    },
    executed,
    ...over,
  } as any;
}

export const collect = () => {
  const events: AgentEvent[] = [];
  return { events, emit: (e: AgentEvent) => events.push(e), types: () => events.map((e) => e.type) };
};
