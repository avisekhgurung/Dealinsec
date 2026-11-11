/**
 * Where the assistant's product knowledge is read from. What this guards: a deploy ships the build folder and
 * nothing else, so the knowledge must be found INSIDE the build, beside the server file. For a day after the move to
 * our own server it was looked for in the project folder only, wasn't there, and the assistant answered without it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { knowledgeDirs, knowledgeStatus, readKnowledgeFiles, retrieveKnowledge } from "./knowledge";

const made: string[] = [];
afterEach(() => made.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const folder = (files: Record<string, string> = {}) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dis-knowledge-")); made.push(d);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(d, name), text);
  return d;
};

describe("where the knowledge is looked for", () => {
  it("first beside the server file (inside the build), then in the project folder", () => {
    expect(knowledgeDirs("/srv/app/dist", "/somewhere/else")).toEqual(["/srv/app/dist/ai-knowledge", "/somewhere/else/ai-knowledge"]);
  });
  it("run from source there is no server-file folder, and only the project folder applies", () => {
    expect(knowledgeDirs(null, "/project")).toEqual(["/project/ai-knowledge"]);
  });
});

describe("reading the knowledge files", () => {
  it("takes the markdown files of the first folder that has any, in a stable order", () => {
    const build = folder({ "workflows.md": "how", "faq.md": "q", "notes.txt": "ignored" }), project = folder({ "other.md": "x" });
    const r = readKnowledgeFiles([build, project]);
    expect(r.dir).toBe(build);
    expect(r.files).toEqual([{ name: "faq.md", text: "q" }, { name: "workflows.md", text: "how" }]);
  });
  it("a deployed server (no project folder at all) still finds the knowledge inside its build", () => {
    const build = folder({ "product.md": "what it is" });
    expect(readKnowledgeFiles([build, "/no/such/project/ai-knowledge"]).files.map((f) => f.name)).toEqual(["product.md"]);
  });
  it("falls back to the project folder when the build has none (running from source)", () => {
    const project = folder({ "product.md": "what it is" });
    expect(readKnowledgeFiles(["/no/such/dist/ai-knowledge", project])).toMatchObject({ dir: project, files: [{ name: "product.md" }] });
    expect(readKnowledgeFiles([folder(), project])).toMatchObject({ dir: project }); // an empty folder is not "found"
  });
  it("nothing anywhere is reported with a reason, and never throws", () => {
    expect(readKnowledgeFiles(["/no/such/a", "/no/such/b"])).toEqual({ dir: null, files: [], error: "ENOENT" });
    expect(readKnowledgeFiles([folder()])).toEqual({ dir: null, files: [], error: "empty" });
    expect(readKnowledgeFiles([])).toEqual({ dir: null, files: [], error: "empty" });
  });
});

describe("the knowledge this project ships", () => {
  it("every how-to file is loaded, beside the generated product facts", () => {
    const k = knowledgeStatus();
    expect(k.howTo).toBeGreaterThanOrEqual(8);
    expect(k.documents).toBe(k.howTo + 1);
    for (const name of ["product-facts.md", "product.md", "navigation.md", "workflows.md", "faq.md", "permissions.md", "pricing.md", "terminology.md", "features.md"]) expect(k.names).toContain(name);
  });
  it("an answer's context carries the verified facts and the product overview, plus what matches the question", () => {
    const text = retrieveKnowledge("how do I change who can see invoices, which permissions");
    expect(text).toContain("--- product-facts.md ---");
    expect(text).toContain("--- product.md ---");
    expect(text).toContain("--- permissions.md ---");
  });
});
