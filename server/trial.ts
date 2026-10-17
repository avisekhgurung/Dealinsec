/**
 * The ONLY place a trial is ever granted. One atomic guarded UPDATE —
 * NEVER a read-then-write and NEVER a GREATEST()-style extend: the client
 * can PATCH /api/profile freely, so any non-atomic path here is an
 * infinite free-Pro lever. `undefined` return = already used, ineligible,
 * or not the billing owner. Nothing else may ever write trial_ends_at.
 *
 * Called from: PATCH /api/profile (onboardingComplete false → true).
 *
 * NEW TRIALS ARE OFF (18 Oct 2026): DealInSec is Free + Pro, with no trial. This grants nothing unless
 * PRO_TRIAL_ENABLED=true is set explicitly (kept only as a rollback switch). Trials already granted are
 * untouched: hasActiveTrial() still reads trial_ends_at, so an existing trialist keeps Pro until that date
 * and nobody loses access early; trial_started_at stays as the permanent record.
 *
 * Why `org_role = 'OWNER' AND invited_by IS NULL` is airtight: OWNER is not
 * in INVITABLE_ROLES, invite creation validates the role, promotion to
 * OWNER is blocked, and only the two signup paths ever write the literal.
 * Invited members inherit the owner's entitlement through getBillingUser()
 * — per-member trial fields must never exist.
 *
 * The NOT EXISTS clause is the canonical-email dedupe: one trial per real
 * mailbox (a.b+x@gmail.com ≡ ab@gmail.com), which is what makes farming
 * cost a fresh non-aliased mailbox instead of nothing.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { users, TRIAL_DAYS, type User } from "@shared/schema";

/** New trials are granted only when this is explicitly switched on. Off by default. */
export const trialGrantsEnabled = (env: NodeJS.ProcessEnv = process.env) => env.PRO_TRIAL_ENABLED === "true";

export async function maybeStartTrial(userId: string, env: NodeJS.ProcessEnv = process.env): Promise<User | undefined> {
  if (!trialGrantsEnabled(env)) return undefined;
  const [granted] = await db
    .update(users)
    .set({
      trialStartedAt: sql`now()`,
      trialEndsAt: sql`now() + make_interval(days => ${TRIAL_DAYS})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(users.id, userId),
        isNull(users.trialStartedAt),          // one-shot, forever
        eq(users.orgRole, "OWNER"),            // only self-service org creators
        isNull(users.invitedBy),               // belt & braces vs future "transfer ownership"
        eq(users.onboardingComplete, true),    // clock starts when they're in the product
        sql`NOT EXISTS (
          SELECT 1 FROM users x
           WHERE x.email_canonical = ${users.emailCanonical}
             AND x.id <> ${users.id}
             AND x.trial_started_at IS NOT NULL)`,
      ),
    )
    .returning();
  return granted;
}
