/**
 * E2E: paste a source (glb URL / Sketchfab link / weapon name) into the
 * Fetch & Explode box, wait for the exploded viewer, disassemble, screenshot.
 *
 *   node scripts/e2e_paste_flow.mjs "<source>" <outPng> [baseUrl]
 */
import puppeteer from 'puppeteer';

const [source, outPng, baseUrl = 'http://localhost:5173'] = process.argv.slice(2);

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForSelector('#paste-source-input', { timeout: 60000 });
await page.type('#paste-source-input', source);
await page.click('#btn-open-source');

await page.waitForSelector('#btn-disassemble', { timeout: 300000 });
await page.waitForFunction(
  () => /components tracked/.test(document.body.innerText),
  { timeout: 120000 },
);
const tracked = await page.evaluate(
  () => document.body.innerText.match(/(\d+) components tracked/)?.[1],
);
console.log(`[ok] components tracked: ${tracked}`);

await page.click('#btn-disassemble');
await new Promise((r) => setTimeout(r, 4500));
await page.screenshot({ path: outPng });
console.log(`[ok] screenshot -> ${outPng}`);
await browser.close();
