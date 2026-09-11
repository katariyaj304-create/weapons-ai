// Capture the asset library card grid by scrolling the first card into view.
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForSelector('.asset-card', { timeout: 30000 });
await page.evaluate(() => document.querySelector('.asset-card').scrollIntoView({ block: 'start' }));
await new Promise((r) => setTimeout(r, 3500)); // let card thumbnails load
await page.screenshot({ path: '../docs/handbook/shots/02_library_cards.png' });
console.log('[ok] cards');
await browser.close();
