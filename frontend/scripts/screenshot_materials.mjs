import puppeteer from 'puppeteer';

const OUT = process.argv[2] || 'materials.png';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 2000, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });
await page.waitForSelector('#sidenav-materials', { timeout: 15000 });
await page.click('#sidenav-materials');
await page.waitForSelector('#materials-page', { timeout: 5000 });

await page.waitForSelector('.evo-preset', { timeout: 5000 });
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.evo-preset')].find((x) => x.textContent.trim() === 'AK-47');
  if (b) { b.click(); return true; }
  return false;
});
console.log('AK-47 preset clicked:', clicked);

await page.waitForSelector('.mat-grid .mat-comp', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1800));

const stats = await page.evaluate(() => ({
  weapon: document.querySelector('.evo-profile-title h2')?.textContent,
  components: document.querySelectorAll('.mat-comp').length,
  props: document.querySelectorAll('.mat-prop').length,
  critical: document.querySelectorAll('.mat-crit').length,
  criteria: document.querySelectorAll('.mat-criterion').length,
  costRows: document.querySelectorAll('.mat-cost-row').length,
  recs: document.querySelectorAll('.mat-rec').length,
  cites: document.querySelectorAll('.evo-cite').length,
  sources: document.querySelectorAll('.evo-source').length,
}));
console.log('RENDERED:', JSON.stringify(stats));

await page.screenshot({ path: OUT, fullPage: true });
console.log('screenshot ->', OUT);
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
