/**
 * Reading and writing evaluation results, and identifying WHAT was evaluated.
 *
 * A result file records the model, the dataset version, a fingerprint of the
 * system prompt plus the tool descriptions the model sees, and the git commit,
 * so two reports can be compared knowing exactly what changed between them.
 * The records hold assertion outcomes and counts, never message text.
 */
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RunRecord } from "./metrics";
import type { Prices } from "./pricing";

export interface ResultsMeta {
  startedAt: string;
  model: string;
  dataset: string;
  datasetVersion: string;
  /** Short hash of the system prompt + tool names/descriptions/schemas. */
  promptHash: string;
  gitSha: string;
  repeat: number;
  maxCalls: number;
  prices: Prices;
}

export interface ResultsFile {
  meta: ResultsMeta;
  records: RunRecord[];
}

/** What the model is told. Change a prompt or a tool description and this changes. */
export function promptFingerprint(systemPrompt: string, toolSpecs: unknown): string {
  return crypto.createHash("sha256").update(systemPrompt).update("\n").update(JSON.stringify(toolSpecs)).digest("hex").slice(0, 12);
}

export function gitSha(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain -- server shared", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() ? "+dirty" : "";
    return sha + dirty;
  } catch {
    return "unknown";
  }
}

export function writeResults(dir: string, file: ResultsFile, name?: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name ?? `${file.meta.startedAt.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(target, JSON.stringify(file, null, 1));
  return target;
}

export function readResults(file: string): ResultsFile {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed?.meta || !Array.isArray(parsed.records)) throw new Error(`${file} is not an evaluation results file`);
  return parsed as ResultsFile;
}
