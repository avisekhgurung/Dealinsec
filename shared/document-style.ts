/**
 * How the printable documents (quotation, agreement, invoice) look: an accent
 * colour, a typeface and a short footer note. Presentation only, never content.
 *
 * Deliberately a short list, not a colour picker: every accent here is dark enough
 * to carry white text and print legibly in black and white, a typeface is one of
 * two that are always installed, and nothing a person types ever becomes a CSS
 * value (only a KEY into these tables does).
 *
 * The footer note appears on quotations and invoices. It is NOT applied to an
 * agreement: what is printed on a signed document is part of what was signed.
 */
import { z } from "zod";

export const ACCENTS = {
  emerald: { label: "Emerald", brand: "#047857", end: "#0d9488", soft: "#ecfdf5" },
  blue: { label: "Blue", brand: "#1d4ed8", end: "#2563eb", soft: "#eff6ff" },
  indigo: { label: "Indigo", brand: "#4338ca", end: "#4f46e5", soft: "#eef2ff" },
  teal: { label: "Teal", brand: "#0f766e", end: "#0d9488", soft: "#f0fdfa" },
  slate: { label: "Slate", brand: "#334155", end: "#475569", soft: "#f1f5f9" },
  rose: { label: "Rose", brand: "#be123c", end: "#e11d48", soft: "#fff1f2" },
  amber: { label: "Amber", brand: "#b45309", end: "#c2410c", soft: "#fffbeb" },
  purple: { label: "Purple", brand: "#7e22ce", end: "#9333ea", soft: "#faf5ff" },
} as const;
export type AccentKey = keyof typeof ACCENTS;
export const ACCENT_KEYS = Object.keys(ACCENTS) as [AccentKey, ...AccentKey[]];

export const FONTS = {
  sans: { label: "Clean (sans-serif)", css: '"Inter", -apple-system, "Segoe UI", Roboto, sans-serif' },
  serif: { label: "Classic (serif)", css: 'Georgia, "Times New Roman", Times, serif' },
} as const;
export type FontKey = keyof typeof FONTS;

export const MAX_FOOTER_NOTE = 160;

export interface DocumentStyle { accent: AccentKey; font: FontKey; footerNote: string | null }
export const DEFAULT_DOCUMENT_STYLE: DocumentStyle = { accent: "emerald", font: "sans", footerNote: null };

/** Plain text only: no control characters, no markup, one line. */
export function cleanFooterNote(raw: unknown): string | null {
  // eslint-disable-next-line no-control-regex
  const t = String(raw ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_FOOTER_NOTE);
  return t || null;
}

export const documentStyleInput = z.object({
  accent: z.enum(ACCENT_KEYS).optional().describe(`One of: ${ACCENT_KEYS.join(", ")}`),
  font: z.enum(["sans", "serif"]).optional().describe("sans = clean modern; serif = classic"),
  footerNote: z.string().max(400).nullable().optional().describe(`A short line printed at the foot of quotations and invoices (max ${MAX_FOOTER_NOTE} characters); null removes it`),
});
export type DocumentStyleInput = z.infer<typeof documentStyleInput>;

/** Whatever was stored (or nothing): always a valid style. */
export function normalizeStyle(raw: Partial<Record<keyof DocumentStyle, unknown>> | null | undefined): DocumentStyle {
  // An OWN property: `in` would also accept "__proto__", "constructor", "toString"...
  const accent = typeof raw?.accent === "string" && Object.prototype.hasOwnProperty.call(ACCENTS, raw.accent) ? (raw.accent as AccentKey) : DEFAULT_DOCUMENT_STYLE.accent;
  const font = raw?.font === "serif" ? "serif" : "sans";
  return { accent, font, footerNote: cleanFooterNote(raw?.footerNote) };
}

/** CSS custom properties for the document root: the only way a style reaches the page. */
export function styleVars(style: DocumentStyle): Record<string, string> {
  const a = ACCENTS[style.accent];
  return { "--doc-brand": a.brand, "--doc-brand-end": a.end, "--doc-brand-soft": a.soft, "--doc-font": FONTS[style.font].css };
}
