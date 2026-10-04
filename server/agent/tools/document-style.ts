/**
 * How the organization's printable documents look. Presentation only (an accent
 * colour from a short fixed list, one of two typefaces, a short footer note), so
 * it is a routine change: it asks at autonomy 0 and runs at 1. It cannot touch
 * what a document SAYS, and the footer note is never printed on an agreement.
 */
import { z } from "zod";
import { ACCENT_KEYS, ACCENTS, FONTS, documentStyleInput } from "@shared/document-style";
import { getDocumentStyle, planDocumentStyle, saveDocumentStyle } from "../../services/document-style";
import { needsPermission, needsRead } from "../policy";
import type { AgentTool, ToolContext, ToolOutcome } from "../types";
import { fail } from "./shared";

const who = (ctx: ToolContext) => ctx.user as any;

const getStyle: AgentTool<Record<string, never>> = {
  name: "get_document_style",
  description: "How the organization's quotations, agreements and invoices currently look: accent colour, typeface and footer note, and the choices available.",
  risk: "READ_ONLY", activity: "searching",
  input: z.object({}),
  authorize: needsRead("deals"),
  async run(ctx): Promise<ToolOutcome> {
    const r = await getDocumentStyle(who(ctx));
    if (!r.ok) return fail(r.code, r.message);
    const s = r.style;
    return {
      ok: true, route: "/settings",
      summary: [
        `Accent colour: ${ACCENTS[s.accent].label}${r.isSet ? "" : " (the default)"}`, `Typeface: ${FONTS[s.font].label}`, `Footer note: ${s.footerNote ?? "none"}`,
        `Accent choices: ${ACCENT_KEYS.join(", ")}. Typefaces: sans, serif. The footer note appears on quotations and invoices, not on agreements.`,
      ].join("\n"),
    };
  },
};

const updateStyle: AgentTool<z.infer<typeof documentStyleInput>> = {
  name: "update_document_style",
  description: `Change how quotations, agreements and invoices LOOK: the accent colour (${ACCENT_KEYS.join(", ")}), the typeface (sans or serif), or a short footer note printed on quotations and invoices (not on agreements). This changes appearance only, never what a document says. Only what the user asked for.`,
  risk: "SAFE_MUTATION",
  input: documentStyleInput,
  authorize: needsPermission("org.settings", "changing how documents look"),
  async prepare(ctx, input) {
    const p = await planDocumentStyle(who(ctx), input);
    if (!p.ok) return { ok: false, code: p.code, message: p.message };
    return { ok: true, args: input as Record<string, unknown>, preview: { title: "Change how your documents look", lines: p.changes.map((c) => ({ label: c.label, value: `${c.from} → ${c.to}` })), effects: ["Applies to quotations and invoices you print from now on, and to agreements' colour and typeface. Nothing is sent to anyone."] } };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await saveDocumentStyle(who(ctx), args);
    return r.ok ? { ok: true, route: "/settings", summary: `Updated how your documents look: ${r.changes.map((c) => c.label.toLowerCase()).join(", ")}.` } : fail(r.code, r.message);
  },
};

export const DOCUMENT_STYLE_TOOLS: AgentTool<any>[] = [getStyle, updateStyle];
