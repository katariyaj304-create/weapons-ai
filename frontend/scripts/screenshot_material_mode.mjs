import puppeteer from 'puppeteer';

const OUT = process.argv[2] || 'material_mode';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1500, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });
await page.waitForSelector('#sidenav-materials', { timeout: 15000 });
await page.click('#sidenav-materials');

// Switch to "By Material" mode
await page.waitForSelector('#mat-mode-material', { timeout: 5000 });
await page.click('#mat-mode-material');
await new Promise((r) => setTimeout(r, 300));

// Click the 7075-T6 preset (server-cached from earlier test)
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.evo-preset')].find((x) => x.textContent.includes('7075'));
  if (b) { b.click(); return b.textContent; }
  return null;
});
console.log('preset clicked:', clicked);

await page.waitForSelector('.mat-radar', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

const stats = await page.evaluate(() => ({
  material: document.querySelector('.evo-profile-title h2')?.textContent,
  radarDots: document.querySelectorAll('.mat-radar-dot').length,
  radarLabels: document.querySelectorAll('.mat-radar-label').length,
  props: document.querySelectorAll('.mat-prop-table tr').length,
  failures: document.querySelectorAll('.mat-failure-chip').length,
  apps: document.querySelectorAll('.mat-app').length,
  pros: document.querySelectorAll('.mat-pc-line.good').length,
  cons: document.querySelectorAll('.mat-pc-line.bad').length,
  alts: document.querySelectorAll('.mat-alt').length,
  cites: document.querySelectorAll('.evo-cite').length,
  sources: document.querySelectorAll('.evo-source').length,
}));
console.log('RENDERED:', JSON.stringify(stats));

await page.screenshot({ path: `${OUT}_top.png` });
await page.evaluate(() => document.querySelector('.mat-proscons')?.scrollIntoView());
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${OUT}_bottom.png` });
console.log('screenshots ->', `${OUT}_top.png`, `${OUT}_bottom.png`);
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
