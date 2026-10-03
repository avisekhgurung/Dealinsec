/**
 * The shape of an evaluation dataset. Cases are DATA (JSON), checked by this
 * schema when loaded, so adding a case is an edit to a file, not code, and a
 * malformed case fails loudly before any model call is spent.
 *
 * A case seeds an in-memory world, sends one or more user turns through the
 * real agent, and states what must hold afterwards. `{{deal.acme}}` style
 * placeholders in turns and expectations are replaced with the ids the seeded
 * records received.
 */
import { z } from "zod";

const ref = z.string().regex(/^[a-z][a-z0-9_]*$/, "refs are lower_snake_case");

const dealSpec = z.object({
  ref,
  brandName: z.string(),
  dealTitle: z.string(),
  dealType: z.string().optional(),
  amountMinor: z.number().int().positive(),
  status: z.enum(["Pending", "Active", "Completed"]).default("Pending"),
  customTerms: z.string().optional(),
});

const leadSpec = z.object({
  ref,
  companyName: z.string(),
  status: z.enum(["new", "researching", "qualified", "contacted", "replied", "meeting", "proposal", "won", "lost"]).default("new"),
  website: z.string().optional(),
  estValueMinor: z.number().int().positive().optional(),
});

export const worldSpecSchema = z.object({
  audience: z.enum(["client_work", "brand_collaboration"]).default("client_work"),
  plan: z.enum(["pro", "free"]).default("pro"),
  /** 0 asks before every change; 1 lets safe internal changes run. */
  autonomy: z.union([z.literal(0), z.literal(1)]).default(0),
  user: z.object({ orgRole: z.string().optional(), customPermissions: z.array(z.string()).optional() }).optional(),
  deals: z.array(dealSpec).default([]),
  quotes: z.array(z.object({ deal: ref, status: z.string().default("draft") })).default([]),
  contracts: z.array(z.object({ ref, deal: ref, signed: z.boolean().default(false) })).default([]),
  invoices: z.array(z.object({
    ref, deal: ref,
    status: z.enum(["Paid", "Unpaid"]).default("Unpaid"),
    amountMinor: z.number().int().positive().default(500_000),
    /** Negative = overdue by that many days. */
    dueInDays: z.number().int().default(14),
  })).default([]),
  /** Records that belong to ANOTHER organization: the agent must never see them. */
  foreignDeals: z.array(z.object({ ref, brandName: z.string(), dealTitle: z.string() })).default([]),
  /** The user's own leads (the pipeline), and leads that belong to ANOTHER organization. */
  leads: z.array(leadSpec).default([]),
  foreignLeads: z.array(leadSpec).default([]),
});
export type WorldSpec = z.infer<typeof worldSpecSchema>;

const re = z.object({ pattern: z.string(), flags: z.string().default("i") });
const safety = z.boolean().optional();

/** What must hold. `safety: true` marks an assertion whose failure is a safety failure. */
export const expectationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("calledTool"), tool: z.string(), safety }),
  z.object({ type: z.literal("calledAnyOf"), tools: z.array(z.string()).min(1), safety }),
  z.object({ type: z.literal("firstToolIn"), tools: z.array(z.string()).min(1), safety }),
  z.object({ type: z.literal("toolsForbidden"), tools: z.array(z.string()).min(1), safety }),
  z.object({ type: z.literal("toolsAllowed"), tools: z.array(z.string()), safety }),
  z.object({ type: z.literal("maxToolCalls"), n: z.number().int().nonnegative(), safety }),
  z.object({ type: z.literal("maxSteps"), n: z.number().int().positive(), safety }),
  z.object({ type: z.literal("approval"), tool: z.string(), argsSubset: z.record(z.unknown()).optional(), safety }),
  z.object({ type: z.literal("noApproval"), tool: z.string().optional(), safety }),
  z.object({ type: z.literal("approvalArgsAbsent"), tool: z.string(), keys: z.array(z.string()).min(1), safety }),
  z.object({ type: z.literal("executedTool"), tool: z.string(), safety }),
  z.object({ type: z.literal("noExecutedMutation"), safety }),
  z.object({ type: z.literal("worldUnchanged"), safety }),
  z.object({ type: z.literal("noEmailsSent"), safety }),
  z.object({ type: z.literal("noUnconfirmedClaim"), safety }),
  z.object({ type: z.literal("noInventedFields"), safety }),
  z.object({ type: z.literal("replyMatches"), pattern: z.string(), flags: z.string().default("i"), safety }),
  z.object({ type: z.literal("replyMustNotMatch"), pattern: z.string(), flags: z.string().default("i"), safety }),
  z.object({ type: z.literal("asksFor"), pattern: z.string(), flags: z.string().default("i"), safety }),
]);
export type Expectation = z.infer<typeof expectationSchema>;
export type RegexSpec = z.infer<typeof re>;

export const evalCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string(),
  tags: z.array(z.string()).default([]),
  world: worldSpecSchema.default({}),
  /** The user's messages, sent in order into ONE conversation. */
  turns: z.array(z.string().min(1)).min(1),
  expect: z.array(expectationSchema).min(1),
});
export type EvalCase = z.infer<typeof evalCaseSchema>;

export const datasetSchema = z.object({
  name: z.string(),
  version: z.string(),
  cases: z.array(evalCaseSchema).min(1),
}).superRefine((d, ctx) => {
  const seen = new Set<string>();
  for (const c of d.cases) {
    if (seen.has(c.id)) ctx.addIssue({ code: "custom", message: `duplicate case id "${c.id}"` });
    seen.add(c.id);
  }
});
export type EvalDataset = z.infer<typeof datasetSchema>;

export function parseDataset(raw: unknown): EvalDataset {
  return datasetSchema.parse(raw);
}
