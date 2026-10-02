/**
 * Registry validation. Pure; run once when the tool list is assembled so a
 * mistake (a duplicate name, a mutation with no prepare step, a schema the
 * model can't be shown) stops the server at startup instead of surfacing as a
 * confusing failure in the middle of someone's conversation.
 */
import { toolSpecs } from "./jsonschema";
import type { AgentTool } from "./types";

export function validateRegistry<T extends readonly AgentTool<any>[]>(tools: T): T {
  const seen = new Set<string>();
  for (const t of tools) {
    const where = `agent tool "${t.name}"`;
    if (!/^[a-z][a-z0-9_]{2,47}$/.test(t.name)) throw new Error(`${where}: names are lower_snake_case, 3-48 characters`);
    if (seen.has(t.name)) throw new Error(`${where}: duplicate name`);
    seen.add(t.name);
    if (t.description.trim().length < 20) throw new Error(`${where}: the model needs a real description`);
    if (typeof t.authorize !== "function") throw new Error(`${where}: every tool declares its authorization`);
    if (t.risk === "READ_ONLY") {
      if (typeof t.run !== "function") throw new Error(`${where}: a read tool needs run()`);
      if (t.prepare || t.execute) throw new Error(`${where}: a read tool can't write — remove prepare/execute or change its risk class`);
    } else if (typeof t.prepare !== "function" || typeof t.execute !== "function") {
      throw new Error(`${where}: a mutation tool needs both prepare() and execute()`);
    }
  }
  toolSpecs(tools); // throws on a schema type the model can't be shown
  return tools;
}
