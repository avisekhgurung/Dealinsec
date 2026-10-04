/**
 * What the agent may change about the workspace and the person's own details.
 * Pure: the same rules are read by the service, the tools and the tests.
 *
 * Deliberately absent, because a wrong value here is a legal or financial
 * problem rather than a typo: bank details, signature, seal, photo, password,
 * email, region and currency, plan and seats, team roles, and deleting anything.
 * Those stay with the person, in Settings.
 */
import { z } from "zod";
import { AUDIENCES } from "./audience";

const trimmed = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters.`);
/** Tax ids and phone numbers: letters, digits, spaces and a few separators. */
const idLike = (max: number) => z.string().trim().max(max).regex(/^[A-Za-z0-9 .+()\-/]*$/, "Use only letters, numbers, spaces and - . + ( ) /");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD.").refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, "That isn't a real date.");

export const invoiceDetailsSchema = z.object({
  invoiceId: z.number().describe("Invoice id"),
  dueDate: isoDate.optional().describe("New due date, YYYY-MM-DD"),
  notes: trimmed(1000).optional().describe("The note printed on the invoice; an empty string clears it"),
}).strict();
export type InvoiceDetails = z.infer<typeof invoiceDetailsSchema>;

export const workspaceProfileSchema = z.object({
  name: trimmed(80).min(1, "The workspace needs a name.").optional().describe("The workspace (business) name"),
  industry: trimmed(60).optional().describe("Industry; an empty string clears it"),
  audience: z.enum(AUDIENCES).optional().describe("client_work or brand_collaboration: only changes wording and what the new-deal picker offers first"),
}).strict();
export type WorkspaceProfile = z.infer<typeof workspaceProfileSchema>;

export const myDetailsSchema = z.object({
  firstName: trimmed(60).min(1, "First name can't be empty.").optional(),
  lastName: trimmed(60).optional(),
  phone: idLike(24).optional(),
  panNumber: idLike(20).optional().describe("Tax id (PAN), printed on invoices"),
  gstNumber: idLike(20).optional().describe("GST/VAT number, printed on invoices"),
  billingAddress: trimmed(300).optional().describe("Address printed on invoices"),
}).strict();
export type MyDetails = z.infer<typeof myDetailsSchema>;

/** Fields that appear on documents sent to clients. Changing one always asks. */
export const PRINTED_FIELDS = ["panNumber", "gstNumber", "billingAddress", "firstName", "lastName"] as const;

export const isEmpty = (edit: Record<string, unknown>, keys: readonly string[]): boolean => !keys.some((k) => (edit as any)[k] !== undefined);
