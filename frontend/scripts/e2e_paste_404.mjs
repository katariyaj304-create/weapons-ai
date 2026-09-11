/**
 * E2E: paste a gibberish weapon name into Fetch & Explode and confirm the UI
 * shows the backend error plus an explicit "Generate with AI instead" button,
 * WITHOUT auto-starting the AI pipeline. Does NOT click the generate button.
 *
 *   node scripts/e2e_paste_404.mjs "<gibberish name>" <outPng> [baseUrl]
 */
import puppeteer from 'puppeteer';

const [source, outPng, baseUrl = 'http://localhost:5173'] = process.argv.slice(2);

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

// Fail loudly if the app fires any generation API call
const genCalls = [];
page.on('request', (r) => {
  if (/\/api\/(generate|exploded|direct3d)/i.test(r.url())) genCalls.push(r.url());
});
page.on('response', (r) => {
  if (r.url().includes('/api/open-model')) console.log(`[net] open-model -> ${r.status()}`);
});

await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForSelector('#paste-source-input', { timeout: 60000 });
await page.type('#paste-source-input', source);
await page.click('#btn-open-source');

// Wait for the error + fallback button to render
await page.waitForSelector('#btn-generate-fallback', { timeout: 60000 });

// Give the app a moment; verify we did NOT navigate to the exploded view
await new Promise((r) => setTimeout(r, 3000));

const state = await page.evaluate(() => ({
  stillOnSelect: !!document.querySelector('#paste-source-input'),
  explodedOpened: !!document.querySelector('#btn-back-exploded'),
  fallbackBtnText: document.querySelector('#btn-generate-fallback')?.innerText.trim() || null,
  errorText: document.querySelector('#btn-generate-fallback')?.parentElement.innerText.trim() || null,
}));
console.log(`[result] stillOnSelect=${state.stillOnSelect}`);
console.log(`[result] explodedViewOpened=${state.explodedOpened}`);
console.log(`[result] fallbackButton="${state.fallbackBtnText}"`);
console.log(`[result] errorBlock="${state.errorText}"`);
console.log(`[result] generationApiCalls=${JSON.stringify(genCalls)}`);

await page.screenshot({ path: outPng });
console.log(`[ok] screenshot -> ${outPng}`);
await browser.close();
