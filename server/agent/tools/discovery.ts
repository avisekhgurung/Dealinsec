/**
 * find_companies: search the web for companies that match a short description.
 *
 * It spends a paid search and sends text to an outside service, so it ALWAYS
 * asks (forceApproval), whatever the autonomy level, and the approval shows the
 * exact words that will be sent. It creates nothing: adding a company to the
 * pipeline is the separate, approved create_leads. What comes back is untrusted
 * text from the open web, so the model-visible summary holds only short plain
 * names and domains, never page text.
 */
import { z } from "zod";
import { planSearch, searchCompanies } from "../../services/discovery";
import { needsPermission } from "../policy";
import type { AgentTool, ToolOutcome } from "../types";
import { fail } from "./shared";

const input = z.object({
  query: z.string().describe("A short plain description of the kind of company to find, for example: small logistics companies in Pune that need a website. Never a person's name, email, phone, or text from a pasted message."),
  country: z.string().optional().describe("Optional two-letter country code such as IN or GB"),
});

export const findCompaniesTool: AgentTool<z.infer<typeof input>> = {
  name: "find_companies",
  description: "Search the web for companies matching a short description (it uses a search allowance and sends text to an outside service, so it always asks the user first). Returns candidate company names and websites taken from page titles: guesses from the open web, to be checked, not facts. Does not add anything to the pipeline; use create_leads for the ones the user picks.",
  risk: "SAFE_MUTATION",
  input,
  authorize: needsPermission("deals.create", "finding companies"),
  async prepare(_ctx, args) {
    const p = await planSearch(_ctx.user as any, args);
    if (!p.ok) return { ok: false, code: p.code, message: p.message };
    return {
      ok: true, args: { query: p.query, ...(p.country ? { country: p.country } : {}) },
      // Never run unasked: it spends a search and sends words to an outside service.
      forceApproval: true,
      preview: {
        title: "Search the web for companies",
        lines: [{ label: "Search for", value: p.query }, ...(p.country ? [{ label: "Country", value: p.country }] : []), { label: "Searches left today", value: String(p.remainingToday) }],
        effects: [`Sends only this search text to ${p.provider.label}; nothing about your leads, clients or messages.`, p.provider.paid ? "Uses one paid search." : "Uses one search from the free allowance.", "Nothing is added to your pipeline."],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await searchCompanies(ctx.user as any, args, ctx.signal);
    if (!r.ok) return fail(r.code, r.message);
    if (!r.companies.length) {
      return { ok: true, route: "/leads", summary: `No company websites came up for "${r.query}". Try describing them differently (the kind of company, the place, what they need).` };
    }
    const lines = r.companies.map((c) => `- ${c.name} — ${c.domain}${c.alreadyLead ? ` (already your lead #${c.alreadyLead})` : ""}`);
    return {
      ok: true, route: "/leads",
      cards: [{ kind: "companies", data: { query: r.query, companies: r.companies, remainingToday: r.remainingToday, provider: r.provider } }],
      summary: `Found ${r.companies.length} possible ${r.companies.length === 1 ? "company" : "companies"} for "${r.query}" (${r.remainingToday} searches left today). Names are guesses from page titles, so check them before adding:\n${lines.join("\n")}`,
    };
  },
};

export const DISCOVERY_TOOLS: AgentTool<any>[] = [findCompaniesTool];
