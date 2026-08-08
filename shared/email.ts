/**
 * Canonical mailbox identity — used ONLY for trial dedupe, never for login.
 *
 * Folds the aliases Gmail hands out for free (dots and +tags: a.b+x@gmail.com
 * ≡ ab@gmail.com, googlemail.com ≡ gmail.com) so one real mailbox can't mint
 * unlimited trials. For every other domain only the +tag is stripped —
 * dot-folding is a Gmail-specific rule.
 *
 * MUST stay byte-for-byte in sync with the SQL backfill in
 * script/migrate-trial.ts — the trial grant's dedupe subquery compares the
 * column this produces.
 */

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function canonicalEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  const parts = s.split("@");
  // Mirrors the SQL guard: position('@' in email) > 1 (non-empty local part).
  if (parts.length < 2 || parts[0].length === 0 || !parts[1]) return null;
  const local = parts[0].split("+")[0];
  const domain = parts[1];
  if (GMAIL_DOMAINS.has(domain)) {
    return `${local.replace(/\./g, "")}@gmail.com`;
  }
  return `${local}@${domain}`;
}
