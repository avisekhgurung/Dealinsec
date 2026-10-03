/**
 * "Are these tables there?" for a feature that must switch itself off, not
 * crash the app, on a database that has not been migrated. A positive answer is
 * cached for good, a negative is rechecked every 30 seconds, and concurrent
 * callers share one query (the agent gate learned this the hard way).
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

export function tablesReadyCheck(tables: string[]): () => Promise<boolean> {
  let ready = false;
  let lastCheck = 0;
  let inflight: Promise<boolean> | null = null;
  return () => {
    if (ready) return Promise.resolve(true);
    if (inflight) return inflight;
    if (lastCheck && Date.now() - lastCheck < 30_000) return Promise.resolve(false);
    inflight = (async () => {
      try {
        const r = await db.execute(sql`
          SELECT count(*)::int AS n FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name IN (${sql.join(tables.map((t) => sql`${t}`), sql`, `)})`);
        ready = Number((r.rows?.[0] as { n?: unknown })?.n) === tables.length;
        return ready;
      } finally {
        lastCheck = Date.now();
        inflight = null;
      }
    })();
    return inflight;
  };
}
