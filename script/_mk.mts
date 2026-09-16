import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox"] });
const p = await b.newPage();
const dir = "/private/tmp/claude-501/-Users-avisekhgurung-Downloads-Dealinsec/550ce954-7ae4-4e34-9065-7e7e415b0a58/scratchpad/callscript";
await p.goto(`file://${dir}/script.html`, { waitUntil: "networkidle0" });
await p.pdf({ path: `${dir}/DealInSec-Cold-Call-Script.pdf`, printBackground: true, preferCSSPageSize: true, format: "a4" });
await b.close();
console.log("pdf written");
