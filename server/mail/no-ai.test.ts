/**
 * The founder's rule (14 Oct 2026): Gmail content never reaches an AI model. Enforced in two directions, statically:
 *  - nothing in the Gmail code (sync, parsing, matching, rules, applying replies, the inbox) or the follow-up drafter
 *    imports a model client or the AI agent;
 *  - nothing in the AI side (agent, Copilot, knowledge search, model clients) reads the synced-mail tables or the inbox.
 * The runtime side (no model call during sync, apply, follow-ups or the inbox) is reply-workflow.pg.test.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
});
const importsOf = (p: string) => Array.from(readFileSync(p, "utf8").matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)"/gm)).map((m) => m[1]);
const AI = /(^|\/)(llm|copilot|agent|knowledge|voice)(\/|$)|openai|anthropic|deepseek|\bai\b/i;

describe("no Gmail content reaches an AI model", () => {
  it("the Gmail code and the follow-up drafter import no model client and no AI module", () => {
    const gmail = [...files(join(root, "mail")), join(root, "sales", "followups.ts")];
    const offenders = gmail.flatMap((f) => importsOf(f).filter((i) => AI.test(i) && i !== "../agent/log").map((i) => `${f.replace(root, "server")} → ${i}`));
    expect(offenders).toEqual([]);
  });

  it("the AI side never reads synced mail or the inbox", () => {
    const ai = ["agent", "copilot", "knowledge", "llm", "voice"].flatMap((d) => { try { return files(join(root, d)); } catch { return []; } });
    const offenders = ai.filter((f) => /mailMessages|mail_messages|mailThreads|mail_threads|mail\/inbox|reply-apply|mail\/sync-/.test(readFileSync(f, "utf8"))).map((f) => f.replace(root, "server"));
    expect(offenders).toEqual([]);
  });
});
