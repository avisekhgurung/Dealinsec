/**
 * Ledger keys in `app_migrations`, and NOTHING else.
 *
 * This module exists so that code which only needs to ASK whether a migration
 * ran — the server's boot-time schema gate, the seed scripts' local-DB guard —
 * never imports the migration script itself. Importing the script bundled its
 * CLI into the server, and the only thing keeping that CLI from firing at boot
 * was a substring test on the entry file's absolute path: a checkout or
 * worktree in a directory named after the script would have started the
 * migration from `npm run dev`, against the shared production database, before
 * the gate ran. A module with no imports and no statements but constants
 * cannot do anything when loaded, whatever path it is loaded from.
 */

/** The money minor-units migration's ledger key. Changing it re-runs the
 *  migration and multiplies every amount by 100 a second time — it is frozen
 *  for the life of the database. */
export const MONEY_MINOR_UNITS_KEY = "2026_09_money_minor_units";
