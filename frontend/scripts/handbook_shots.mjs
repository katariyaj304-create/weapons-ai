// One-off capture of remaining handbook screenshots: viewer, news, stack, library fullpage.
import puppeteer from 'puppeteer';

const OUT = '../docs/handbook/shots';
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 120000 });
await new Promise((r) => setTimeout(r, 3000));

// Full-page library shot (cards + generators + panels)
await page.screenshot({ path: `${OUT}/02_library_full.png`, fullPage: true });
console.log('[ok] library fullpage');

// Open the first asset card -> 3D viewer
await page.waitForSelector('.asset-card', { timeout: 30000 });
await page.click('.asset-card');
await new Promise((r) => setTimeout(r, 12000)); // let GLB load + render
await page.screenshot({ path: `${OUT}/03_viewer.png` });
console.log('[ok] viewer');

// Field News
await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });
await page.waitForSelector('#sidenav-news', { timeout: 15000 });
await page.click('#sidenav-news');
try {
  await page.waitForFunction(() => document.querySelectorAll('#news-page a, #news-page article, .news-card').length > 2, { timeout: 45000 });
} catch { console.log('[warn] news items slow'); }
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${OUT}/08_news.png` });
console.log('[ok] news');

// Tech Stack
await page.click('#sidenav-stack');
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${OUT}/09_stack.png` });
console.log('[ok] stack');

await browser.close();
