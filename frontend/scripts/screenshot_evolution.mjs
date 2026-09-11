import puppeteer from 'puppeteer';

const OUT = process.argv[2] || 'evolution.png';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1600, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });

// Navigate to the Evolution page via the sidebar.
await page.waitForSelector('#sidenav-evolution', { timeout: 15000 });
await page.click('#sidenav-evolution');
await page.waitForSelector('#evolution-page', { timeout: 5000 });

// Click the AK-47 preset (server-cached, so it resolves fast).
await page.waitForSelector('.evo-preset', { timeout: 5000 });
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.evo-preset')].find((x) => x.textContent.trim() === 'AK-47');
  if (b) { b.click(); return true; }
  return false;
});
console.log('AK-47 preset clicked:', clicked);

// Wait for the timeline to render.
await page.waitForSelector('.evo-timeline .evo-node', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500)); // let framer-motion settle

const stats = await page.evaluate(() => ({
  weapon: document.querySelector('.evo-profile-title h2')?.textContent,
  stages: document.querySelectorAll('.evo-node').length,
  changes: document.querySelectorAll('.evo-change').length,
  cites: document.querySelectorAll('.evo-cite').length,
  sources: document.querySelectorAll('.evo-source').length,
  profileCells: document.querySelectorAll('.evo-profile-cell').length,
}));
console.log('RENDERED:', JSON.stringify(stats));

await page.screenshot({ path: OUT, fullPage: true });
console.log('screenshot ->', OUT);
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
else console.log('no console errors');

await browser.close();
