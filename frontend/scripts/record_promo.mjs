/**
 * record_promo.mjs — drives the running Ivory Command app with puppeteer and
 * records each demo scene as JPEG frame sequences (CDP screencast) with
 * per-frame timestamps, for the promo film assembler.
 *
 * Output: ../video/build/rec/<scene>/f000000.jpg + meta.json
 * Stills:  ../video/build/stills/<name>.png (for the outro recap wall)
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', '..', 'video', 'build', 'rec');
const STILLS = path.resolve(__dirname, '..', '..', 'video', 'build', 'stills');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(STILLS, { recursive: true });

const APP = 'http://localhost:5173';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

const browser = await puppeteer.launch({
  headless: false,
  args: ['--window-size=1936,1200', '--window-position=0,0', '--disable-infobars', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = (await browser.pages())[0];
page.on('pageerror', e => console.log('[page error]', String(e).slice(0, 200)));
const client = await page.createCDPSession();

// ---------------- screencast recorder ----------------
let rec = null; // {dir, idx, meta}
client.on('Page.screencastFrame', e => {
  if (rec) {
    const f = path.join(rec.dir, `f${String(rec.idx).padStart(6, '0')}.jpg`);
    fs.writeFileSync(f, Buffer.from(e.data, 'base64'));
    rec.meta.push(e.metadata.timestamp);
    rec.idx++;
  }
  client.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
});
async function startRec(name) {
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  rec = { dir, idx: 0, meta: [] };
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  console.log(`[rec] ${name} started`);
}
async function stopRec() {
  await client.send('Page.stopScreencast');
  await sleep(300);
  const r = rec; rec = null;
  fs.writeFileSync(path.join(r.dir, 'meta.json'), JSON.stringify(r.meta));
  console.log(`[rec] stopped — ${r.idx} frames, ${r.meta.length ? (r.meta[r.meta.length - 1] - r.meta[0]).toFixed(1) : 0}s`);
}

// ---------------- interaction helpers ----------------
async function drag(x1, y1, x2, y2, ms) {
  const steps = Math.max(24, Math.floor(ms / 16));
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const u = ease(i / steps);
    await page.mouse.move(x1 + (x2 - x1) * u, y1 + (y2 - y1) * u);
    await sleep(ms / steps);
  }
  await page.mouse.up();
}
async function wheel(x, y, total, ms) {
  await page.mouse.move(x, y);
  const n = Math.max(8, Math.floor(ms / 90));
  for (let i = 0; i < n; i++) { await page.mouse.wheel({ deltaY: total / n }); await sleep(ms / n); }
}
// smooth-scroll the app's scrollable container
async function scrollContainer(px, ms) {
  await page.evaluate(async (px, ms) => {
    const cands = [document.querySelector('.main-content'), document.querySelector('.main-content-inner'),
      document.scrollingElement, document.querySelector('.panel-content')].filter(Boolean);
    const el = cands.find(c => c.scrollHeight > c.clientHeight + 40) || cands[0];
    const start = el.scrollTop, t0 = performance.now();
    await new Promise(res => {
      const step = now => {
        const u = Math.min(1, (now - t0) / ms);
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        el.scrollTop = start + px * e;
        u < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });
  }, px, ms);
}
async function scrollPanel(sel, px, ms) {
  await page.evaluate(async (sel, px, ms) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const start = el.scrollTop, t0 = performance.now();
    await new Promise(res => {
      const step = now => {
        const u = Math.min(1, (now - t0) / ms);
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        el.scrollTop = start + px * e;
        u < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });
  }, sel, px, ms);
}
async function clickSel(sel) {
  await page.waitForSelector(sel, { timeout: 45000 });
  await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
  await sleep(400);
  await page.click(sel);
}
// Return to the library even if the viewer's back button is missing (recovers from a UI crash)
async function goLibrary() {
  const back = await page.$('#btn-back');
  if (back) { await back.click(); await sleep(1500); }
  if (!(await page.$('#asset-card-ak-47'))) {
    console.log('[recover] reloading app to reach the library');
    await page.goto(APP, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForSelector('#asset-card-ak-47', { timeout: 60000 });
    await sleep(2500);
  }
}
const CX = 860, CY = 500; // canvas orbit center (viewer canvas area, left of side panel)

async function orbitShow(seconds) {
  // slow right pan, slight down-tilt, zoom-in, reverse pan, zoom-out
  const t = seconds * 1000;
  await drag(CX - 260, CY, CX + 320, CY - 40, t * 0.30);
  await sleep(150);
  await wheel(CX, CY, -1400, t * 0.16);
  await drag(CX + 200, CY - 40, CX - 300, CY + 60, t * 0.30);
  await sleep(150);
  await wheel(CX, CY, 900, t * 0.12);
  await sleep(t * 0.08);
}

// ---------------- scenes ----------------
console.log('loading app...');
await page.goto(APP, { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForSelector('#asset-card-ak-47', { timeout: 60000 });
await sleep(2500);

// SCENE 1: library grid scroll
await page.evaluate(() => {
  const el = document.querySelector('.main-content') || document.scrollingElement;
  const grid = document.querySelector('.asset-grid');
  if (grid) el.scrollTop = grid.offsetTop - 140; // start at the asset grid, skip generator cards
});
await sleep(1200);
await startRec('library');
await sleep(2200);
await scrollContainer(1500, 9000);
await sleep(800);
await scrollContainer(-1500, 5000);
await sleep(1200);
await stopRec();
await page.screenshot({ path: path.join(STILLS, 's1_library.png') });

// SCENE 2: AK-47 open + orbit
await clickSel('#asset-card-ak-47');
console.log('AK-47 loading...');
await sleep(9000); // model load off-record
await startRec('ak47');
await sleep(1500);
await orbitShow(24);
await sleep(800);
await stopRec();

// SCENE 3: intelligence sweep
await clickSel('#btn-sweep');
await startRec('sweep_start');
await sleep(6000);
await stopRec();
console.log('waiting for research to complete (up to 6 min)...');
let researchOk = false;
for (let i = 0; i < 120; i++) {
  await sleep(3000);
  const state = await page.evaluate(() => ({
    parts: document.querySelectorAll('.parts-list > *').length,
    error: document.querySelector('.error-banner')?.textContent || null,
  }));
  if (state.parts > 0) { researchOk = true; break; }
  if (state.error) { console.log('research error:', state.error); break; }
  if (i % 10 === 0) console.log(`  ...still researching (${i * 3}s)`);
}
console.log('researchOk =', researchOk);

if (researchOk) {
  await sleep(2000);
  // SCENE 4: annotations orbit
  await startRec('annotations');
  await sleep(1800);
  await drag(CX - 220, CY, CX + 260, CY - 30, 6500);
  await sleep(1000);
  await stopRec();
  await page.screenshot({ path: path.join(STILLS, 's2_intel.png') });

  // SCENE 5: click-to-focus on 3 parts
  await startRec('partfocus');
  const rows = await page.$$('.parts-list > *');
  for (const r of rows.slice(0, 3)) {
    await r.click().catch(() => {});
    await sleep(3400);
  }
  await sleep(800);
  await stopRec();

  // SCENE 6: research tab scroll
  await clickSel('#tab-research');
  await sleep(1500);
  await startRec('research');
  await sleep(2500);
  await scrollPanel('.panel-content', 1400, 14000);
  await sleep(1500);
  await stopRec();
}

// SCENE 7: tank
await goLibrary();
await clickSel('#asset-card-t-72a-obr-1980');
console.log('tank loading...');
await sleep(12000);
await startRec('tank');
await sleep(1200);
await drag(CX - 240, CY + 60, CX + 300, CY - 80, 5200);
await wheel(CX, CY, -1100, 2200);
await drag(CX + 200, CY - 60, CX - 280, CY + 30, 5200);
await wheel(CX, CY, 800, 1800);
await sleep(700);
await stopRec();

// SCENE 8: jet
await goLibrary();
let jetSel = '#asset-card-sukhoi-su-57-felon-fighter-jet-free';
if (!(await page.$(jetSel))) jetSel = '#asset-card-jet-fighter';
await clickSel(jetSel);
console.log('jet loading...');
await sleep(12000);
await startRec('jet');
await sleep(1200);
await drag(CX - 260, CY + 80, CX + 300, CY - 100, 5200);
await wheel(CX, CY, -1000, 2000);
await drag(CX + 220, CY - 40, CX - 260, CY + 40, 5000);
await sleep(700);
await stopRec();

// SCENE 9: field news
await clickSel('#sidenav-news');
console.log('news loading...');
await page.waitForFunction(() => {
  const p = document.querySelector('#news-page');
  return p && p.querySelectorAll('a, article, .news-card, [class*="news"]').length > 3;
}, { timeout: 90000 }).catch(() => console.log('news wait timed out, recording anyway'));
await sleep(2000);
await startRec('news');
await sleep(3000);
await scrollContainer(900, 7000);
await sleep(600);
// click 2 topic chips by text
for (const chip of ['Missiles & Drones', 'Armor']) {
  const clicked = await page.evaluate(txt => {
    const btns = [...document.querySelectorAll('#news-page button')];
    const b = btns.find(x => x.textContent.trim() === txt);
    if (b) { b.click(); return true; } return false;
  }, chip);
  console.log('chip', chip, clicked);
  await sleep(6000);
}
await scrollContainer(700, 5000);
await sleep(1000);
await stopRec();
await page.screenshot({ path: path.join(STILLS, 's3_news.png') });

// SCENE 10: tech stack
await clickSel('#sidenav-stack');
await sleep(2500);
await startRec('stack');
await sleep(2500);
await scrollContainer(2400, 18000);
await sleep(800);
await scrollContainer(500, 3000);
await sleep(1000);
await stopRec();
await page.screenshot({ path: path.join(STILLS, 's4_stack.png') });

console.log('ALL SCENES DONE. researchOk=' + researchOk);
await browser.close();
process.exit(0);
