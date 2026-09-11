// Screenshot any app URL headlessly: node scripts/shot_page.mjs <url> <out.png>
import puppeteer from 'puppeteer';

const [url, out] = process.argv.slice(2);
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
await new Promise((r) => setTimeout(r, 4000));
await page.screenshot({ path: out });
console.log(`saved ${out}`);
await browser.close();
