/**
 * The hash a person approves: the exact subject and body together, so a change to either needs a new approval. Sending
 * also requires a single-line subject, so where the subject ends and the body begins is never ambiguous.
 * Server only (node:crypto); the client receives hashes, it never computes them.
 */
import { createHash } from "node:crypto";

export const hashDraft = (subject: string, body: string): string => createHash("sha256").update(`${subject.trim()}\n${body.trim()}`).digest("hex");
