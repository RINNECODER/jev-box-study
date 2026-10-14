// Run the real page headless on folders of images and save each report (raw scores) to OUT.
// Usage: node browser_eval.mjs OUT.json DIR [DIR...]   (needs `node dev.mjs` on :4871)
import { createRequire } from "node:module";
import { readdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || `${process.env.HOME}/.npm/_npx/9833c18b2d85bc59/node_modules/playwright`);

const [out, ...dirs] = process.argv.slice(2);
const files = dirs.flatMap(d => readdirSync(d).filter(f => /\.(jpe?g|png)$/i.test(f)).sort().map(f => join(d, f)));
const browser = await chromium.launch({ executablePath: process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell` });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:4871/");
const results = [];
for (let i = 0; i < files.length; i += 3) {          // 3 files at a time
  const batch = files.slice(i, i + 3);
  const before = await page.evaluate(() => (window.__hc || []).length);
  await page.setInputFiles("#file", batch);
  await page.waitForFunction(n => (window.__hc || []).length >= n, before + batch.length, { timeout: 600000 });
  const got = await page.evaluate(n => window.__hc.slice(n), before);
  for (const r of got) { r.path = batch.find(p => basename(p) === r.file); results.push(r); console.log(r.file, r.error || `ai=${r.ai} flagged=${r.frames[0].flagged}`); }
  writeFileSync(out, JSON.stringify(results));
}
await browser.close();
