/**
 * Move files stored before private uploads (public ImageKit URLs) to private ImageKit files.
 * See server/imagekit-migration.ts for the method. Stages, each explicit:
 *
 *   npx tsx script/migrate-imagekit-private.ts                       plan only (read-only; prints counts, no URLs)
 *   npx tsx script/migrate-imagekit-private.ts --apply  --confirm-host=<db host> --journal=<file>
 *   npx tsx script/migrate-imagekit-private.ts --revoke --confirm-host=<db host> --journal=<file>
 *
 * --apply copies each public original to a private file and repoints the rows (compare-and-set); it never deletes.
 * --revoke deletes originals that nothing references any more and purges their CDN cache. Run it only after the
 * app version that serves /files/... is live and the apply journal has been reviewed.
 *
 * Needs DATABASE_URL, SESSION_SECRET (the SAME secret as the running app: it tags the new names), and the three
 * IMAGEKIT_* variables. The journal holds file URLs: keep it out of the repository and delete it when done.
 */
import fs from "fs";
import path from "path";
import pg from "pg";
import ImageKit from "imagekit";
import { applyMigration, createPgRefStore, planMigration, revokeOriginals, type JournalEntry } from "../server/imagekit-migration";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const host = new URL(url).hostname;
  const mode = has("apply") ? "apply" : has("revoke") ? "revoke" : "plan";
  if (mode !== "plan" && arg("confirm-host") !== host) throw new Error(`--${mode} needs --confirm-host=${host} (the database this will change)`);
  const journalPath = arg("journal");
  if (mode !== "plan" && !journalPath) throw new Error(`--${mode} needs --journal=<file>`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const store = createPgRefStore(client);
    const endpoint = process.env.IMAGEKIT_URL_ENDPOINT ?? null;
    const plan = planMigration(await store.loadUrlRefs(), endpoint);
    console.log(JSON.stringify({ mode, host, counts: plan.counts }, null, 1));
    if (mode === "plan") return;

    for (const k of ["IMAGEKIT_PUBLIC_KEY", "IMAGEKIT_PRIVATE_KEY", "IMAGEKIT_URL_ENDPOINT", "SESSION_SECRET"]) if (!process.env[k]) throw new Error(`${k} is required`);
    const ik = new ImageKit({ publicKey: process.env.IMAGEKIT_PUBLIC_KEY!, privateKey: process.env.IMAGEKIT_PRIVATE_KEY!, urlEndpoint: endpoint! });

    if (mode === "apply") {
      if (fs.existsSync(journalPath!)) throw new Error("the journal file exists already; use a new path");
      const journal = await applyMigration(plan, {
        uploadPrivateFromUrl: async (sourceUrl, folder, fileName) => {
          const r: any = await ik.upload({ file: sourceUrl, fileName, folder, useUniqueFileName: false, overwriteFile: false, isPrivateFile: true });
          // The upload response has no isPrivateFile: read the stored file's own record (unreadable = not private).
          const stored: any = await ik.getFileDetails(r.fileId).catch(() => null);
          return { fileId: r.fileId, isPrivateFile: stored?.isPrivateFile === true, name: r.name };
        },
        signedSourceUrl: (p) => ik.url({ path: p, signed: true, expireSeconds: 600 }),
        repoint: (rows, oldValue, newRef) => store.repoint(rows, oldValue, newRef),
        deletePrivateCopy: async (id) => { await ik.deleteFile(id); },
      }, process.env.SESSION_SECRET!);
      fs.writeFileSync(journalPath!, JSON.stringify(journal, null, 1), { mode: 0o600 });
      console.log(JSON.stringify({ copies: journal.length, rowsRepointed: journal.reduce((s, e) => s + e.repointed, 0) }));
      return;
    }

    const journal: JournalEntry[] = JSON.parse(fs.readFileSync(journalPath!, "utf8"));
    const result = await revokeOriginals(journal, {
      countReferences: (values) => store.countReferences(values),
      findOriginal: async (p) => {
        const files: any[] = await ik.listFiles({ path: path.posix.dirname(p), searchQuery: `name = "${path.posix.basename(p)}"` } as any);
        return files.find((f) => f.filePath === p)?.fileId ?? null;
      },
      deleteOriginal: async (id) => { await ik.deleteFile(id); },
      purge: async (u) => { await ik.purgeCache(u); },
    });
    console.log(JSON.stringify(result));
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(err?.message ?? err); process.exit(1); });
