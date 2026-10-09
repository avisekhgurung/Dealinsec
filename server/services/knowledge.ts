/**
 * Knowledge: what a workspace adds so the agent can use it when looking for
 * clients. The REST routes and the agent's tools both call these functions, so a
 * source is checked, cut up, stored and found by one piece of code.
 *
 * Permissions follow the lead pipeline (read = whoever may read deals, change =
 * whoever may change leads). Everything is scoped to the caller's organization:
 * no function here takes an organization id from outside.
 *
 * What is stored is text, cut into passages. A PDF's original file is NOT kept
 * (only its words); a picture IS kept, privately, with the person's description
 * of it, because the model cannot read pictures and the description is what is
 * searched. A page is fetched once, when it is added, and never again.
 */
import crypto from "node:crypto";
import path from "node:path";
import { LIMITS, chunkText, imageCaptionSchema, noteInputSchema, queryTerms, sniffFileKind, titleFromUrl, urlInputSchema } from "@shared/knowledge";
import type { KnowledgeSourceRow, User } from "@shared/schema";
import { logOrgActivity } from "../entitlements";
import { extractHtml, extractPdf, extractPlainText, type Extracted } from "../knowledge/extract";
import { fetchPublicPage, realPageIO, validatePublicUrl, type PageIO } from "../knowledge/net-guard";
import { knowledgeStore as store, type SourceInput } from "../knowledge/store";
import { fail, firstIssue, readGate, writeGate, type Result, type Who } from "./leads";

export interface SourceView {
  id: string; kind: string; title: string; sourceUrl: string | null; fileName: string | null; description: string | null;
  chars: number; chunkCount: number; truncated: boolean; hasFile: boolean; createdAt: string;
}
const view = (r: KnowledgeSourceRow): SourceView => ({
  id: r.id, kind: r.kind, title: r.title, sourceUrl: r.sourceUrl, fileName: r.fileName, description: r.description,
  chars: r.chars, chunkCount: r.chunkCount, truncated: r.truncated, hasFile: r.kind === "image", createdAt: r.createdAt.toISOString(),
});
const sha = (data: Uint8Array | string) => crypto.createHash("sha256").update(data).digest("hex");
const safeFileName = (name: string) => path.basename(name).replace(/[^\w.\- ()À-￿]/g, "_").slice(0, 200) || "file";
const stem = (name: string) => name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[-_]+/g, " ").trim().slice(0, 120) || "Untitled";

export async function listKnowledge(user: Who): Promise<Result<{ sources: SourceView[]; usage: { sources: number; chunks: number }; limits: { sources: number; chunks: number; pdfBytes: number; imageBytes: number } }>> {
  const gate = readGate(user);
  if (gate) return gate;
  const [rows, usage] = await Promise.all([store.list(user.organizationId!), store.usage(user.organizationId!)]);
  return { ok: true, sources: rows.map(view), usage, limits: { sources: LIMITS.sourcesPerOrg, chunks: LIMITS.chunksPerOrg, pdfBytes: LIMITS.pdfBytes, imageBytes: LIMITS.imageBytes } };
}

/** The one place a source is admitted: caps, duplicates, passages, storage, trail. */
async function ingest(user: Who, input: Omit<SourceInput, "chars" | "addedBy">, text: string, file?: { mime: string; bytes: Buffer }): Promise<Result<{ source: SourceView }>> {
  const orgId = user.organizationId!;
  const chunks = chunkText(text);
  if (!chunks.length) return fail(400, "empty", "There's no text to add.");
  const usage = await store.usage(orgId);
  if (usage.sources >= LIMITS.sourcesPerOrg) return fail(409, "limit", `You've reached ${LIMITS.sourcesPerOrg} sources. Remove one you no longer need first.`);
  if (usage.chunks + chunks.length > LIMITS.chunksPerOrg) return fail(409, "limit", "Your knowledge is full. Remove a source you no longer need first.");
  const existing = await store.findByHash(orgId, input.sha256);
  if (existing) return fail(409, "duplicate", `That's already added as "${existing.title}".`);
  try {
    const row = await store.create(orgId, { ...input, chars: text.length, addedBy: user.id }, chunks, file);
    logOrgActivity(user as User, "added", "knowledge", row.id, `${input.kind}: ${input.title}`);
    return { ok: true, source: view(row) };
  } catch (e) {
    // Two identical uploads racing: the unique index decides, not the check above.
    if ((e as { code?: string })?.code === "23505") return fail(409, "duplicate", "That's already added.");
    throw e;
  }
}

export async function addNote(user: Who, raw: unknown): Promise<Result<{ source: SourceView }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  const p = noteInputSchema.safeParse(raw);
  if (!p.success) return fail(400, "invalid", firstIssue(p.error));
  return ingest(user, { kind: "note", title: p.data.title, sha256: sha(`${p.data.title}\n${p.data.text}`), truncated: false }, p.data.text);
}

/** What adding this link would do, WITHOUT fetching it: what a tool shows before asking. */
export function planAddUrl(user: Who, raw: unknown): Result<{ url: URL; title: string }> {
  const gate = writeGate(user);
  if (gate) return gate;
  const p = urlInputSchema.safeParse(raw);
  if (!p.success) return fail(400, "invalid", firstIssue(p.error));
  const v = validatePublicUrl(p.data.url);
  if (!v.ok) return fail(400, "bad_url", v.message);
  return { ok: true, url: v.url, title: p.data.title ?? titleFromUrl(v.url) };
}

export async function addUrl(user: Who, raw: unknown, io: PageIO = realPageIO): Promise<Result<{ source: SourceView }>> {
  const plan = planAddUrl(user, raw);
  if (!plan.ok) return plan;
  const page = await fetchPublicPage(plan.url.toString(), io);
  if (!page.ok) return fail(page.code === "blocked" ? 400 : 422, page.code, page.message);
  const ex: Extracted = page.contentType === "pdf" ? await extractPdf(page.bytes) : page.contentType === "html" ? await extractHtml(page.bytes) : extractPlainText(page.bytes);
  if (!ex.ok) return fail(422, "unreadable", ex.message);
  const given = (raw as { title?: string }).title?.trim();
  const title = (given || ex.title || plan.title).slice(0, 160);
  return ingest(user, { kind: "url", title, sourceUrl: page.url.toString(), sha256: sha(ex.text), truncated: ex.truncated }, ex.text);
}

export async function addPdf(user: Who, file: { bytes: Buffer; name: string }, titleRaw?: string): Promise<Result<{ source: SourceView }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  if (file.bytes.length > LIMITS.pdfBytes) return fail(413, "too_big", `That PDF is over ${Math.round(LIMITS.pdfBytes / 1048576)} MB.`);
  if (sniffFileKind(file.bytes) !== "pdf") return fail(415, "not_pdf", "That file isn't a PDF.");
  const ex = await extractPdf(file.bytes);
  if (!ex.ok) return fail(422, "unreadable", ex.message);
  const name = safeFileName(file.name);
  return ingest(user, { kind: "pdf", title: (titleRaw?.trim() || stem(name)).slice(0, 160), fileName: name, mime: "application/pdf", sizeBytes: file.bytes.length, sha256: sha(file.bytes), truncated: ex.truncated }, ex.text);
}

const IMAGE_MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;

export async function addImage(user: Who, file: { bytes: Buffer; name: string }, raw: unknown): Promise<Result<{ source: SourceView }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  if (file.bytes.length > LIMITS.imageBytes) return fail(413, "too_big", `That picture is over ${Math.round(LIMITS.imageBytes / 1048576)} MB.`);
  const kind = sniffFileKind(file.bytes);
  if (kind !== "png" && kind !== "jpeg" && kind !== "webp") return fail(415, "not_image", "Only PNG, JPEG or WebP pictures can be added.");
  const p = imageCaptionSchema.safeParse(raw);
  if (!p.success) return fail(400, "invalid", firstIssue(p.error));
  const mime = IMAGE_MIME[kind];
  return ingest(user, { kind: "image", title: p.data.title, description: p.data.description, fileName: safeFileName(file.name), mime, sizeBytes: file.bytes.length, sha256: sha(file.bytes), truncated: false }, `${p.data.title}. ${p.data.description}`, { mime, bytes: file.bytes });
}

export async function removeSource(user: Who, id: string): Promise<Result<{ title: string }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  const row = await store.get(user.organizationId!, id);
  if (!row) return fail(404, "not_found", "That source isn't in your workspace.");
  if (!(await store.remove(user.organizationId!, id))) return fail(404, "not_found", "That source isn't in your workspace.");
  logOrgActivity(user as User, "removed", "knowledge", id, `${row.kind}: ${row.title}`);
  return { ok: true, title: row.title };
}

export async function readImage(user: Who, id: string): Promise<Result<{ mime: string; bytes: Buffer }>> {
  const gate = readGate(user);
  if (gate) return gate;
  const f = await store.file(user.organizationId!, id);
  return f ? { ok: true, ...f } : fail(404, "not_found", "That picture isn't in your workspace.");
}

/** How many sources the workspace has, for a hint elsewhere; 0 when it cannot be read (no permission, or the tables are not set up). Never throws. */
export async function knowledgeCount(user: Who): Promise<number> {
  try {
    if (readGate(user)) return 0;
    return (await store.usage(user.organizationId!)).sources;
  } catch { return 0; }
}

export interface KnowledgeHit { n: number; sourceId: string; title: string; kind: string; sourceUrl: string | null; text: string }

/** Passages that match the question, best first, at most two from any one source. */
export async function searchKnowledge(user: Who, question: string): Promise<Result<{ hits: KnowledgeHit[]; empty: boolean; terms: string[] }>> {
  const gate = readGate(user);
  if (gate) return gate;
  const orgId = user.organizationId!;
  const terms = queryTerms(String(question ?? ""));
  const { sources } = await store.usage(orgId);
  if (!sources) return { ok: true, hits: [], empty: true, terms };
  if (!terms.length) return fail(400, "invalid", "Ask with a few specific words, for example an industry, a place or a service.");
  const rows = await store.search(orgId, terms, LIMITS.hits * 3);
  const perSource = new Map<string, number>();
  const hits: KnowledgeHit[] = [];
  for (const r of rows) {
    const used = perSource.get(r.sourceId) ?? 0;
    if (used >= 2) continue;
    perSource.set(r.sourceId, used + 1);
    hits.push({ n: hits.length + 1, sourceId: r.sourceId, title: r.title, kind: r.kind, sourceUrl: r.sourceUrl, text: r.content.slice(0, LIMITS.snippetChars) });
    if (hits.length >= LIMITS.hits) break;
  }
  return { ok: true, hits, empty: false, terms };
}

export interface RelatedNote { title: string; kind: string; sourceUrl: string | null; text: string }

/**
 * Passages from the workspace's knowledge that talk about the same things as `text` (a lead's
 * name, industry, place, summary), as context next to a fit check. NOT a score: a passage is
 * shown only when it shares at least two of the words (one, if the text has only one), so a
 * lone common word does not drag in an unrelated note. Never throws; [] when there is nothing.
 */
export async function relatedKnowledge(user: Who, text: string, limit = 2): Promise<RelatedNote[]> {
  try {
    if (readGate(user)) return [];
    const terms = queryTerms(text);
    if (!terms.length) return [];
    // "Cryptocurrency exchange" must find a note that says "crypto": a long word is also searched by its first six letters.
    const searchTerms = Array.from(new Set(terms.flatMap((t) => (t.length >= 8 ? [t, t.slice(0, 6)] : [t]))));
    const rows = await store.search(user.organizationId!, searchTerms, limit * 4);
    const need = Math.min(2, terms.length);
    const stem = (t: string) => t.slice(0, Math.max(4, t.length - 2));
    // A term counts when the note holds its stem, or a word that begins like it (the first five letters or the whole shorter word).
    const hits = (body: string, words: string[], t: string) => body.includes(stem(t)) || words.some((w) => w.length >= 5 && t.length >= 5 && (t.startsWith(w.slice(0, 5)) && w.startsWith(t.slice(0, 5))));
    const out: RelatedNote[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const body = r.content.toLowerCase();
      const words = body.split(/[^a-z0-9À-￿]+/).filter(Boolean);
      if (terms.filter((t) => hits(body, words, t)).length < need || seen.has(r.sourceId)) continue;
      seen.add(r.sourceId);
      out.push({ title: r.title, kind: r.kind, sourceUrl: r.sourceUrl, text: r.content.slice(0, 300) });
      if (out.length >= limit) break;
    }
    return out;
  } catch { return []; }
}
