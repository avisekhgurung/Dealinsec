/**
 * Generates the business-document PDFs exactly the way a user does — Chrome's
 * print engine against the running dev server — and reports page geometry.
 *
 * Usage:
 *   npx tsx --env-file=.env script/pdf-shot.mts '<ids-json-from-pdf-scenarios>' <outdir>
 *
 * Produces <outdir>/<name>.pdf plus a geometry report (page count + size in
 * points per page; A4 = 595.28 × 841.89pt). Visual inspection happens by
 * Reading the PDFs afterwards — this script only guarantees the artifacts.
 */
import puppeteer from "puppeteer-core";
import { PDFDocument } from "pdf-lib";
import fs from "fs";
import path from "path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3000";

const ids = JSON.parse(process.argv[2] || "{}");
const OUT = process.argv[3] || "/tmp/pdf-out";
fs.mkdirSync(OUT, { recursive: true });

const SHOTS: { name: string; url: string; waitFor: string }[] = [
  { name: "quotation-simple", url: `/deals/${ids.dealA}/quote`, waitFor: "main" },
  { name: "quotation-heavy", url: `/deals/${ids.dealB}/quote`, waitFor: "main" },
  { name: "invoice-itemised", url: `/brand-invoices/${ids.invoiceB}`, waitFor: "main" },
  { name: "agreement-heavy-signed", url: `/contracts/${ids.contractB}/export`, waitFor: "main" },
  { name: "agreement-short-awaiting", url: `/contracts/${ids.contractC}/export`, waitFor: "main" },
];

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(`${BASE}/auth?mode=signin`, { waitUntil: "networkidle2" });
    const login = await page.evaluate(async (creds: any) => {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(creds),
      });
      return r.status;
    }, { email: ids.email, password: ids.password });
    if (login !== 200) throw new Error(`login failed: ${login}`);

    const report: any[] = [];
    for (const s of SHOTS) {
      await page.goto(`${BASE}${s.url}`, { waitUntil: "networkidle2" });
      await page.waitForSelector(s.waitFor, { timeout: 15000 });
      // Fonts + images settle before measuring/printing.
      await page.evaluate(async () => {
        await (document as any).fonts?.ready;
        await new Promise((r) => setTimeout(r, 600));
      });
      const file = path.join(OUT, `${s.name}.pdf`);
      await page.pdf({
        path: file,
        printBackground: true,
        preferCSSPageSize: true,
        format: "a4",
      });
      const doc = await PDFDocument.load(fs.readFileSync(file));
      const pages = doc.getPages().map((p, i) => ({
        page: i + 1,
        w: Math.round(p.getWidth() * 100) / 100,
        h: Math.round(p.getHeight() * 100) / 100,
      }));
      report.push({ name: s.name, pageCount: doc.getPageCount(), pages });
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
