/**
 * Agent mode's conversation list: pinned conversations and renaming.
 *
 * Pins live in their own small table (agent_session_pins), not a column on agent_sessions: until
 * script/migrate-agent-pins.ts has run, every existing query keeps working and pinning just says it isn't set up.
 * A pin belongs to the person (organization + user) who owns the conversation; deleting the conversation deletes it.
 */
import { z } from "zod";

/** At most this many pinned conversations per person (the list stays a list). */
export const PIN_LIMIT = 10;

export const AGENT_PIN_TABLES = ["agent_session_pins"] as const;
export const AGENT_PIN_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agent_session_pins (
    session_id varchar PRIMARY KEY,
    organization_id varchar NOT NULL,
    user_id varchar NOT NULL,
    pinned_at timestamp NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS agent_session_pins_person_idx ON agent_session_pins (organization_id, user_id, pinned_at)`,
];

export const renameBody = z.object({ title: z.string().trim().min(1, "Give the conversation a name.").max(80, "Keep the name under 80 characters.") }).strict();
export const pinBody = z.object({ pinned: z.boolean() }).strict();

export interface SessionListRow { id: string; title: string | null; state: string; dealId: number | null; updatedAt: Date }

/** Pinned first (most recently pinned on top), then the rest by last activity. Never lists a conversation twice. */
export function orderSessions<T extends { id: string; updatedAt: Date | string }>(rows: readonly T[], pins: ReadonlyMap<string, Date>): (T & { pinned: boolean })[] {
  const seen = new Set<string>();
  const unique = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  const time = (d: Date | string) => new Date(d).getTime();
  const pinned = unique.filter((r) => pins.has(r.id)).sort((a, b) => time(pins.get(b.id)!) - time(pins.get(a.id)!));
  const rest = unique.filter((r) => !pins.has(r.id)).sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  return [...pinned.map((r) => ({ ...r, pinned: true })), ...rest.map((r) => ({ ...r, pinned: false }))];
}
