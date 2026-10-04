/**
 * One-time migration: knowledge (three tables).
 *
 * PURELY ADDITIVE: CREATE TABLE / INDEX IF NOT EXISTS only. Nothing existing is
 * touched. Without it the knowledge feature is simply off (the server answers
 * 503 KNOWLEDGE_NOT_SETUP); everything else works.
 *
 * knowledge_chunks.tsv is a GENERATED column (Postgres 12+; Neon is newer), so
 * the search index can never drift from the text.
 *
 * Dev and production share one Neon database, so run this deliberately:
 *   npx tsx --env-file=.env script/migrate-knowledge.ts
 * Local test database:
 *   DATABASE_URL=postgresql://dealtest@localhost:5544/dealinsec_pdftest npx tsx script/migrate-knowledge.ts
 *
 * Rollback:  DROP TABLE IF EXISTS knowledge_files, knowledge_chunks, knowledge_sources;
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS knowledge_sources (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id varchar NOT NULL,
    kind varchar(8) NOT NULL,
    title varchar(160) NOT NULL,
    source_url text,
    file_name varchar(200),
    mime varchar(40),
    size_bytes integer,
    sha256 varchar(64) NOT NULL,
    description text,
    chars integer NOT NULL DEFAULT 0,
    chunk_count integer NOT NULL DEFAULT 0,
    truncated boolean NOT NULL DEFAULT false,
    added_by varchar NOT NULL,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS knowledge_sources_org_idx ON knowledge_sources (organization_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS knowledge_sources_org_sha_uq ON knowledge_sources (organization_id, sha256)`,
  `CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id serial PRIMARY KEY,
    source_id varchar NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
    organization_id varchar NOT NULL,
    position integer NOT NULL,
    content text NOT NULL,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
  )`,
  `CREATE INDEX IF NOT EXISTS knowledge_chunks_org_idx ON knowledge_chunks (organization_id)`,
  `CREATE INDEX IF NOT EXISTS knowledge_chunks_source_idx ON knowledge_chunks (source_id, position)`,
  `CREATE INDEX IF NOT EXISTS knowledge_chunks_tsv_idx ON knowledge_chunks USING gin (tsv)`,
  `CREATE TABLE IF NOT EXISTS knowledge_files (
    source_id varchar PRIMARY KEY REFERENCES knowledge_sources(id) ON DELETE CASCADE,
    organization_id varchar NOT NULL,
    mime varchar(40) NOT NULL,
    bytes bytea NOT NULL
  )`,
];

async function main() {
  console.log(`Database host: ${host}`);
  const pool = new pg.Pool({ connectionString: url });
  try {
    for (const s of STATEMENTS) await pool.query(s);
    const r = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('knowledge_sources','knowledge_chunks','knowledge_files')`);
    console.log(`Knowledge tables present: ${r.rows[0].n} of 3.`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
