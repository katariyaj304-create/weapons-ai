import puppeteer from 'puppeteer';
const OUT = process.argv[2] || 'toggle';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1250, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });
await page.click('#sidenav-materials');
await page.waitForSelector('#mat-mode-material', { timeout: 5000 });
await page.click('#mat-mode-material');
await page.evaluate(() => [...document.querySelectorAll('.evo-preset')].find((x) => x.textContent.includes('7075'))?.click());
await page.waitForSelector('.mat-radar', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${OUT}_radar.png`, clip: { x: 300, y: 520, width: 720, height: 700 } });

// Switch back to By Weapon and confirm it clears + runs a weapon
await page.click('#mat-mode-weapon');
await new Promise((r) => setTimeout(r, 300));
const clearedToWeapon = await page.evaluate(() => ({
  hasRadar: !!document.querySelector('.mat-radar'),
  weaponActive: document.querySelector('#mat-mode-weapon')?.classList.contains('active'),
  placeholder: document.querySelector('#mat-input')?.placeholder,
}));
console.log('after switch back:', JSON.stringify(clearedToWeapon));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
