/**
 * The organization's document style: reading it (any member, so every document
 * can print in it) and changing it (whoever may change organization settings).
 */
import { DEFAULT_DOCUMENT_STYLE, cleanFooterNote, documentStyleInput, normalizeStyle, type DocumentStyle } from "@shared/document-style";
import { memberCan } from "@shared/permissions";
import type { User } from "@shared/schema";
import { documentStyleStore } from "../documents/style-store";
import { fail, firstIssue, type Result, type Who } from "./leads";

export async function getDocumentStyle(user: Who): Promise<Result<{ style: DocumentStyle; isSet: boolean }>> {
  if (!user.organizationId) return fail(403, "no_organization", "Finish setting up your workspace first.");
  const row = await documentStyleStore.get(user.organizationId);
  return { ok: true, style: row ? normalizeStyle(row) : DEFAULT_DOCUMENT_STYLE, isSet: !!row };
}

/** What a save would change, without saving: what a tool shows before asking. */
export async function planDocumentStyle(user: Who, raw: unknown): Promise<Result<{ before: DocumentStyle; after: DocumentStyle; changes: { label: string; from: string; to: string }[] }>> {
  if (!user.organizationId) return fail(403, "no_organization", "Finish setting up your workspace first.");
  if (!memberCan(user as User, "org.settings")) return fail(403, "forbidden", "Your role doesn't allow changing how documents look. Ask your organization owner.");
  const p = documentStyleInput.safeParse(raw ?? {});
  if (!p.success) return fail(400, "invalid", firstIssue(p.error));
  const cur = await getDocumentStyle(user);
  if (!cur.ok) return cur;
  const before = cur.style;
  const after: DocumentStyle = {
    accent: p.data.accent ?? before.accent,
    font: p.data.font ?? before.font,
    footerNote: p.data.footerNote === undefined ? before.footerNote : cleanFooterNote(p.data.footerNote),
  };
  const changes = (["accent", "font", "footerNote"] as const)
    .filter((k) => before[k] !== after[k])
    .map((k) => ({ label: k === "footerNote" ? "Footer note" : k === "accent" ? "Accent colour" : "Typeface", from: String(before[k] ?? "none"), to: String(after[k] ?? "none") }));
  if (!changes.length) return fail(400, "no_change", "That's already how your documents look.");
  return { ok: true, before, after, changes };
}

export async function saveDocumentStyle(user: Who, raw: unknown): Promise<Result<{ style: DocumentStyle; changes: { label: string; from: string; to: string }[] }>> {
  const plan = await planDocumentStyle(user, raw);
  if (!plan.ok) return plan;
  await documentStyleStore.save(user.organizationId!, plan.after, user.id);
  return { ok: true, style: plan.after, changes: plan.changes };
}
