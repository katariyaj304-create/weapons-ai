// Render-check the handbook: screenshot cover, a figure chapter, the architecture diagram.
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const url = 'file:///' + path.join(root, 'docs', 'handbook', 'index.html').replace(/\\/g, '/');
const out = path.join(root, 'docs', 'handbook');

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('requestfailed', (r) => errs.push('FAILED: ' + r.url()));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.screenshot({ path: path.join(out, '_check_cover.png') });
await page.evaluate(() => document.getElementById('ch3').scrollIntoView());
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: path.join(out, '_check_ch3.png') });
await page.evaluate(() => document.getElementById('ch4').scrollIntoView());
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: path.join(out, '_check_ch4.png') });
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no errors');
await browser.close();
