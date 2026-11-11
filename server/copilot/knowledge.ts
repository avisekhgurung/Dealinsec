/**
 * DealinSec Copilot — product knowledge system.
 *
 * The verified facts (shared/product-facts.ts: who it's for, what is live, limited or not available, prices and
 * checkout, generated from the code) come first in EVERY answer, so a price or a capability is never taken from a
 * stale copy. The /ai-knowledge markdown files add the how-to detail and are the AUTHORITATIVE product knowledge:
 * the model is instructed to answer from them (plus live tool results) and
 * to say it doesn't know otherwise. Files are loaded once at first use and
 * retrieved by keyword overlap — at this corpus size (~8 small files) a
 * vector index would be pure overhead.
 *
 * Keep these files in sync with the product: any change to UI, routes,
 * workflow, permissions, pricing or terminology must update the matching
 * file in the same commit, and pricing/permissions/workflow edits need
 * founder review (see AI_IMPLEMENTATION_PLAN.md §9). Bump the version on
 * every knowledge change.
 */
import fs from "fs";
import path from "path";
import { productFactsMarkdown } from "@shared/product-facts";

export const AI_KNOWLEDGE_VERSION = "2026-10-17.1";
/** The generated facts document's name in retrieved knowledge. */
export const FACTS_DOC = "product-facts.md";

interface KnowledgeDoc {
  name: string;
  text: string;
  words: Set<string>;
}

let docs: KnowledgeDoc[] | null = null;

const tokenize = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9₹]+/).filter((w) => w.length > 2);

/**
 * Where the knowledge files may be, in order. In a built app they sit INSIDE the build, beside the server file
 * (script/build.ts copies them to dist/ai-knowledge), because a deploy ships dist and nothing else: for a day after
 * the move to our own server (Nov 2026) they were read from the project folder, which wasn't there, and the assistant
 * answered without them. Running from source, they are in the project folder.
 */
// The built server is one CommonJS file, where __dirname is its folder (dist). Run from source as an ES module there is
// no __dirname at all, and only the project folder applies.
const HERE: string | null = typeof __dirname === "string" ? __dirname : null;
export const knowledgeDirs = (here: string | null = HERE, cwd: string = process.cwd()): string[] =>
  [...(here ? [path.resolve(here, "ai-knowledge")] : []), path.resolve(cwd, "ai-knowledge")];

/** The markdown files of the first folder that has any, or [] with the reason. Never throws. */
export function readKnowledgeFiles(dirs: string[] = knowledgeDirs()): { dir: string | null; files: { name: string; text: string }[]; error?: string } {
  let error: string | undefined;
  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), "utf8") }));
      if (files.length) return { dir, files };
    } catch (err) { error = (err as NodeJS.ErrnoException)?.code ?? "unreadable"; }
  }
  return { dir: null, files: [], error: error ?? "empty" };
}

function load(): KnowledgeDoc[] {
  if (docs) return docs;
  const facts = productFactsMarkdown();
  docs = [{ name: FACTS_DOC, text: facts, words: new Set(tokenize(facts)) }];
  const found = readKnowledgeFiles();
  for (const f of found.files) docs.push({ name: f.name, text: f.text, words: new Set(tokenize(f.text)) });
  // Said once, loudly, with where it looked: the assistant still answers from the verified facts, but without the how-to detail.
  if (!found.files.length) console.error(`[copilot] knowledge load failed: no ai-knowledge/*.md found (${found.error}); looked in ${knowledgeDirs().join(" and ")}`);
  return docs;
}

/** How much product knowledge is loaded: for the startup line and for tests. */
export function knowledgeStatus(): { documents: number; howTo: number; names: string[] } {
  const all = load();
  return { documents: all.length, howTo: all.length - 1, names: all.map((d) => d.name) };
}

/** Top-K knowledge files for a query, always including the verified facts and product.md as the grounding context.
 *  Small corpus → whole files, not chunks. */
export function retrieveKnowledge(query: string, k = 3): string {
  const all = load();
  if (!all.length) return "";
  const qWords = tokenize(query);
  const scored = all
    .map((d) => ({
      d,
      score: qWords.reduce((s, w) => s + (d.words.has(w) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score);
  const picked = new Map<string, KnowledgeDoc>();
  for (const name of [FACTS_DOC, "product.md"]) {
    const d = all.find((x) => x.name === name);
    if (d) picked.set(d.name, d);
  }
  for (const { d, score } of scored) {
    if (picked.size >= k + 2) break;
    if (score > 0) picked.set(d.name, d);
  }
  return Array.from(picked.values())
    .map((d) => `--- ${d.name} ---\n${d.text.trim()}`)
    .join("\n\n");
}
