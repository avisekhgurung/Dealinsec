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

function load(): KnowledgeDoc[] {
  if (docs) return docs;
  const dir = path.resolve(process.cwd(), "ai-knowledge");
  const facts = productFactsMarkdown();
  docs = [{ name: FACTS_DOC, text: facts, words: new Set(tokenize(facts)) }];
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      docs.push({ name: file, text, words: new Set(tokenize(text)) });
    }
  } catch (err) {
    console.error("[copilot] knowledge load failed:", err);
  }
  return docs;
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
