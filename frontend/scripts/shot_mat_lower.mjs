import puppeteer from 'puppeteer';
const OUT = process.argv[2] || 'mat_lower.png';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1400, deviceScaleFactor: 1 });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });
await page.waitForSelector('#sidenav-materials', { timeout: 15000 });
await page.click('#sidenav-materials');
await page.waitForSelector('.evo-preset', { timeout: 5000 });
await page.evaluate(() => [...document.querySelectorAll('.evo-preset')].find((x) => x.textContent.trim() === 'AK-47')?.click());
await page.waitForSelector('.mat-two-col', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
// Scroll the selection/cost section into view
await page.evaluate(() => document.querySelector('.mat-two-col')?.scrollIntoView());
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: OUT });
console.log('shot ->', OUT);
await browser.close();
