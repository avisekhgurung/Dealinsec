import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// Schema changes go over the DIRECT connection when there is one: Neon's pooled endpoint (PgBouncer, transaction mode)
// can't hold the session a migration needs. `neon env pull` writes it as DATABASE_URL_UNPOOLED; the app itself keeps
// using the pooled DATABASE_URL (server/db.ts).
const migrationUrl = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL;

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: migrationUrl,
  },
});
