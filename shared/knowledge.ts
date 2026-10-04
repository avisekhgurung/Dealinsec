/**
 * Knowledge: material a workspace adds so the agent can use it when it looks
 * for clients (notes, links, PDFs, pictures). Pure rules shared by the server,
 * the client and the tests: how text is cleaned and cut into passages, how a
 * question becomes a search, what a file really is, and the caps.
 *
 * Retrieval is Postgres full-text search over the passages, not embeddings.
 * It matches words (with English stemming: "hotels" finds "hotel"), not meaning
 * ("firms that hire designers" will not find "agencies commissioning
 * illustration"), which is why the words people actually use matter. Swapping in embeddings later changes only
 * the search function; nothing here depends on it.
 */
import { z } from "zod";

export const KNOWLEDGE_KINDS = ["note", "url", "pdf", "image"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const LIMITS = {
  sourcesPerOrg: 100,
  /** Extracted text kept per source; the rest is dropped and the source says so. */
  charsPerSource: 120_000,
  chunksPerOrg: 4_000,
  pdfBytes: 8 * 1024 * 1024,
  imageBytes: 5 * 1024 * 1024,
  pdfPages: 80,
  pageBytes: 3 * 1024 * 1024,
  noteChars: 20_000,
  chunkChars: 900,
  chunkOverlap: 120,
  /** What one search returns to the agent. */
  hits: 6,
  snippetChars: 700,
} as const;

// ── cleaning and chunking ──────────────────────────────────────────────────

/** Control characters out, line endings and runs of blank space normalised. */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Cut text into passages of about `max` characters, on paragraph then sentence
 * boundaries where it can, with a little overlap so a fact split across a
 * boundary is still found. Never returns an empty passage; every character of
 * the input appears in at least one passage.
 */
export function chunkText(text: string, max: number = LIMITS.chunkChars, overlap: number = LIMITS.chunkOverlap): string[] {
  const clean = cleanText(text);
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + max, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      // Prefer a paragraph break, then a sentence end, then a space, but only in the back half.
      const floor = Math.floor(max / 2);
      const para = window.lastIndexOf("\n\n");
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "), window.lastIndexOf(".\n"));
      const space = window.lastIndexOf(" ");
      const cut = para >= floor ? para : sentence >= floor ? sentence + 1 : space >= floor ? space : -1;
      if (cut > 0) end = start + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    // Step back by the overlap, but start on a word boundary rather than mid-word, and always move forward.
    let next = end - overlap;
    const boundary = clean.slice(next, end).search(/\s/);
    if (boundary >= 0) next += boundary + 1;
    start = Math.max(next, start + 1);
  }
  return out;
}

// ── turning a question into a search ───────────────────────────────────────

const STOP = new Set(("the a an and or of to in on for with by at is are was were be been it its this that these those from as we you i our your my me them they their " +
  "do does did can could should would will find any all some about what which who how when where why not no yes if then than so too very also just into out up over under more most").split(" "));

/** The words worth searching for: lowercase, letters and digits only, no filler, unique, at most 12. */
export function queryTerms(question: string): string[] {
  const seen = new Set<string>();
  for (const w of question.toLowerCase().split(/[^a-z0-9À-￿]+/)) {
    if (w.length < 3 || STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    if (seen.size >= 12) break;
  }
  return Array.from(seen);
}

// ── what a file really is ──────────────────────────────────────────────────

export type SniffedKind = "pdf" | "png" | "jpeg" | "webp" | null;

/** From the first bytes only; the file name and the declared type are never trusted. */
export function sniffFileKind(b: Uint8Array): SniffedKind {
  const has = (sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
  if (b.length >= 5 && has([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (b.length >= 8 && has([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (b.length >= 3 && has([0xff, 0xd8, 0xff])) return "jpeg";
  if (b.length >= 12 && has([0x52, 0x49, 0x46, 0x46]) && has([0x57, 0x45, 0x42, 0x50], 8)) return "webp"; // RIFF....WEBP
  return null;
}

// ── inputs ─────────────────────────────────────────────────────────────────

const title = z.string().trim().min(1, "Give it a short title.").max(120, "Keep the title under 120 characters.");

export const noteInputSchema = z.object({
  title,
  text: z.string().max(LIMITS.noteChars * 2).transform(cleanText).refine((t) => t.length >= 10, "Write at least a sentence.").refine((t) => t.length <= LIMITS.noteChars, `Keep a note under ${LIMITS.noteChars.toLocaleString("en")} characters; add a second one instead.`),
}).strict();
export const urlInputSchema = z.object({ url: z.string().trim().min(1, "Paste a link.").max(2000, "That link is too long."), title: title.optional() }).strict();
export const imageCaptionSchema = z.object({
  title,
  description: z.string().max(LIMITS.noteChars).transform(cleanText).refine((t) => t.length >= 10, "Describe what the picture shows, so it can be found: a sentence or two."),
}).strict();
export type NoteInput = z.infer<typeof noteInputSchema>;

/** A short label for a link when the person gave none: the host and the last path piece. */
export function titleFromUrl(u: URL): string {
  const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "").replace(/[-_]+/g, " ").replace(/\.[a-z0-9]{2,5}$/i, "").trim();
  return (last ? `${u.hostname.replace(/^www\./, "")}: ${last}` : u.hostname.replace(/^www\./, "")).slice(0, 120);
}
