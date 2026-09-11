/**
 * E2E: click a library card's Explode button, verify the exploded viewer opens
 * immediately, then wait for the background deep-research intel to resolve
 * (RESEARCHING COMPONENTS hint gone, or a COMPONENTS badge present).
 *
 *   node scripts/e2e_library_intel.mjs <outPng> [baseUrl] [explodeBtnId]
 */
import puppeteer from 'puppeteer';

const [outPng, baseUrl = 'http://localhost:5173', btnId = 'btn-explode-ak-47'] = process.argv.slice(2);

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('response', (r) => {
  if (r.url().includes('/api/asset-intel')) console.log(`[net] asset-intel -> ${r.status()}`);
});

await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForSelector(`#${btnId}`, { timeout: 60000 });
await page.click(`#${btnId}`);

// Viewer must open immediately, without waiting on intel
await page.waitForSelector('#btn-disassemble', { timeout: 60000 });
await page.waitForFunction(
  () => /components tracked/.test(document.body.innerText),
  { timeout: 120000 },
);
const tracked = await page.evaluate(
  () => document.body.innerText.match(/(\d+) components tracked/)?.[1],
);
console.log(`[ok] viewer opened, ${tracked} components tracked`);

const hintEarly = await page.evaluate(() => !!document.querySelector('#intel-researching-hint'));
console.log(`[info] RESEARCHING COMPONENTS hint visible after open: ${hintEarly}`);

// Wait up to 90s for intel resolution: hint disappears OR a COMPONENTS badge shows up
let intelResolved = true;
try {
  await page.waitForFunction(() => {
    const hint = document.querySelector('#intel-researching-hint');
    const badges = [...document.querySelectorAll('.badge-label')].map((e) => e.textContent.trim());
    return !hint || badges.includes('COMPONENTS');
  }, { timeout: 90000 });
} catch {
  intelResolved = false;
  console.log('[warn] intel still pending after 90s');
}

const state = await page.evaluate(() => {
  const badges = [...document.querySelectorAll('.badge-label')].map((e) => e.textContent.trim());
  let componentsCount = null;
  for (const el of document.querySelectorAll('.badge-label')) {
    if (el.textContent.trim() === 'COMPONENTS') {
      componentsCount = el.parentElement.querySelector('.badge-value')?.textContent.trim();
    }
  }
  const text = document.body.innerText;
  return {
    hintStillVisible: !!document.querySelector('#intel-researching-hint'),
    componentsBadge: badges.includes('COMPONENTS'),
    componentsCount,
    riskChips: ['CRITICAL', 'ELEVATED', 'STABLE'].filter((t) => text.includes(t)),
  };
});
console.log(`[result] intelResolved=${intelResolved}`);
console.log(`[result] hintStillVisible=${state.hintStillVisible}`);
console.log(`[result] componentsBadge=${state.componentsBadge} count=${state.componentsCount}`);
console.log(`[result] riskChips=${JSON.stringify(state.riskChips)}`);

await page.click('#btn-disassemble');
await new Promise((r) => setTimeout(r, 4500));

// Risk-tier chips live in the part balloons — re-check after disassembly
const chipsAfter = await page.evaluate(() => {
  const text = document.body.innerText;
  return ['CRITICAL', 'ELEVATED', 'STABLE'].filter((t) => text.includes(t));
});
console.log(`[result] riskChipsAfterDisassemble=${JSON.stringify(chipsAfter)}`);

await page.screenshot({ path: outPng });
console.log(`[ok] screenshot -> ${outPng}`);
await browser.close();
