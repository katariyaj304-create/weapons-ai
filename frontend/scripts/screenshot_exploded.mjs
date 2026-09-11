/**
 * E2E smoke test: open the exploded viewer on a model via the ?glb= deep
 * link, press Disassemble, and screenshot the result.
 *
 *   node scripts/screenshot_exploded.mjs <glbUrl> <name> <outPng> [baseUrl]
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

// Wait until parts are tracked ("N components tracked" appears)
await page.waitForFunction(
  () => /components tracked/.test(document.body.innerText),
  { timeout: 120000 },
);
const tracked = await page.evaluate(
  () => document.body.innerText.match(/(\d+) components tracked/)?.[1],
);
console.log(`[ok] components tracked: ${tracked}`);

await page.click('#btn-disassemble');
await new Promise((r) => setTimeout(r, 4500)); // let the cascade finish
await page.screenshot({ path: outPng });
console.log(`[ok] screenshot -> ${outPng}`);
await browser.close();
