import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, readdir, cp } from "fs/promises";
import { existsSync } from "fs";
import { precompressDir } from "../server/precompressed";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // The background worker (server/worker.ts): same code, its own entry, run as a separate always-on process.
  await esbuild({
    entryPoints: ["server/worker.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/worker.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // The assistant's product knowledge (ai-knowledge/*.md) is read at run time, and a deploy ships dist and nothing
  // else. So it goes INSIDE the build (server/copilot/knowledge.ts looks beside the server file first). A build
  // without it fails here rather than going live with an assistant that has lost its how-to knowledge.
  await cp("ai-knowledge", "dist/ai-knowledge", { recursive: true });
  const knowledge = (await readdir("dist/ai-knowledge")).filter((f) => f.endsWith(".md"));
  if (!knowledge.length) throw new Error("ai-knowledge has no .md files: the assistant would go live without its product knowledge");
  console.log(`copied ${knowledge.length} knowledge files into dist/ai-knowledge`);

  // A squeezed copy beside every script and style file (server/precompressed.ts), so the first visit downloads about a
  // quarter of the bytes without depending on a web-server setting. A build whose main script has no copy fails here.
  const squeezed = precompressDir("dist/public");
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  console.log(`squeezed ${squeezed.files} files: ${kb(squeezed.rawBytes)} as built, ${kb(squeezed.brBytes)} brotli, ${kb(squeezed.gzBytes)} gzip`);
  const mainScript = (await readFile("dist/public/index.html", "utf-8")).match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  if (!mainScript || !existsSync(`dist/public/${mainScript}.br`) || !existsSync(`dist/public/${mainScript}.gz`)) throw new Error("the page's main script has no squeezed copy: the site would go live sending it at full size");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
