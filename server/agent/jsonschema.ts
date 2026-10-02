/**
 * Minimal zod → JSON Schema for the tool definitions sent to the model, so the
 * schema the model sees is the schema the server validates with (one source).
 * Covers only what the tool inputs use; an unsupported type throws at startup
 * rather than silently advertising the wrong shape.
 */
import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

export function toJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const description = schema.description;
  const withDesc = (s: JsonSchema): JsonSchema => (description ? { ...s, description } : s);

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) {
    const inner = toJsonSchema(schema._def.innerType);
    return description && !inner.description ? { ...inner, description } : inner;
  }
  if (schema instanceof z.ZodEffects) return toJsonSchema(schema._def.schema);
  if (schema instanceof z.ZodString) return withDesc({ type: "string" });
  if (schema instanceof z.ZodNumber) return withDesc({ type: "number" });
  if (schema instanceof z.ZodBoolean) return withDesc({ type: "boolean" });
  if (schema instanceof z.ZodEnum) return withDesc({ type: "string", enum: [...schema.options] });
  if (schema instanceof z.ZodArray) return withDesc({ type: "array", items: toJsonSchema(schema.element) });
  if (schema instanceof z.ZodRecord) return withDesc({ type: "object" });
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const required = Object.entries(shape)
      .filter(([, v]) => !v.isOptional())
      .map(([k]) => k);
    return withDesc({
      type: "object",
      properties: Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, toJsonSchema(v)])),
      ...(required.length ? { required } : {}),
    });
  }
  throw new Error(`toJsonSchema: unsupported zod type ${schema._def?.typeName}`);
}

/** OpenAI-compatible `tools` array for the provider. */
export function toolSpecs(tools: readonly { name: string; description: string; input: z.ZodTypeAny }[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: toJsonSchema(t.input) },
  }));
}
