/**
 * E2E check for the deterministic part-naming layer: open the exploded viewer
 * on a model via the ?glb= deep link and print every Component Sheet row
 * (the names the user actually sees).
 *
 *   node scripts/verify_part_names.mjs <glbUrl> <name> [outPng] [baseUrl]
 */
import puppeteer from 'puppeteer';

const [glbUrl, name, outPng, baseUrl = 'http://localhost:5173'] = process.argv.slice(2);
const url = `${baseUrl}/?glb=${encodeURIComponent(glbUrl)}&name=${encodeURIComponent(name)}`;

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForSelector('#btn-disassemble', { timeout: 60000 });
await page.waitForFunction(
  () => /components tracked/.test(document.body.innerText),
  { timeout: 120000 },
);

const rows = await page.evaluate(() => {
  const panel = document.querySelector('#spec-panel');
  if (!panel) return null;
  return [...panel.children].slice(1).map((row) => {
    const t = row.innerText.replace(/\s+/g, ' ').trim();
    return t;
  }).filter(Boolean);
});
console.log(`=== ${name} ===`);
for (const r of rows || []) console.log('  ' + r);

if (outPng) {
  await page.click('#btn-disassemble');
  await new Promise((r) => setTimeout(r, 4500));
  await page.screenshot({ path: outPng });
  console.log(`[ok] screenshot -> ${outPng}`);
}
await browser.close();
