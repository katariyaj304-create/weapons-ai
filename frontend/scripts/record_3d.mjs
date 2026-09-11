/**
 * record_3d.mjs — re-records ONLY the 3D viewer scenes with a gentle cinematic orbit
 * that keeps the model framed (the first pass zoomed in too hard and lost the subject).
 *
 * Rewrites: build/rec/{ak47, annotations, partfocus, tank, jet}
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', '..', 'video', 'build', 'rec');
const STILLS = path.resolve(__dirname, '..', '..', 'video', 'build', 'stills');

const APP = 'http://localhost:5173';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

const browser = await puppeteer.launch({
  headless: false,
  args: ['--window-size=1936,1200', '--window-position=0,0', '--disable-infobars', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = (await browser.pages())[0];
page.on('pageerror', e => console.log('[page error]', String(e).slice(0, 160)));
const client = await page.createCDPSession();

let rec = null;
client.on('Page.screencastFrame', e => {
  if (rec) {
    fs.writeFileSync(path.join(rec.dir, `f${String(rec.idx).padStart(6, '0')}.jpg`), Buffer.from(e.data, 'base64'));
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
  console.log(`[rec] ${name}`);
}
async function stopRec() {
  await client.send('Page.stopScreencast');
  await sleep(300);
  const r = rec; rec = null;
  fs.writeFileSync(path.join(r.dir, 'meta.json'), JSON.stringify(r.meta));
  const secs = r.meta.length ? (r.meta[r.meta.length - 1] - r.meta[0]).toFixed(1) : 0;
  console.log(`[rec] stopped — ${r.idx} frames, ${secs}s`);
}

// Gentle drag: small deltas keep the subject framed.
async function drag(x1, y1, x2, y2, ms) {
  const steps = Math.max(30, Math.floor(ms / 16));
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const u = ease(i / steps);
    await page.mouse.move(x1 + (x2 - x1) * u, y1 + (y2 - y1) * u);
    await sleep(ms / steps);
  }
  await page.mouse.up();
  await page.mouse.move(x2, y2);
}
const CX = 880, CY = 540;

// Slow turntable that always returns toward the hero angle. No zoom — the default
// framing already fits the model perfectly.
async function cineOrbit(totalMs) {
  const leg = totalMs / 4;
  await drag(CX, CY, CX + 150, CY - 18, leg);        // ease right
  await sleep(250);
  await drag(CX, CY, CX - 130, CY + 22, leg);        // back through center, low
  await sleep(250);
  await drag(CX, CY, CX - 120, CY - 30, leg);        // other side, slight high
  await sleep(250);
  await drag(CX, CY, CX + 110, CY + 12, leg - 500);  // settle back to hero
  await sleep(500);
}
async function clickSel(sel) {
  await page.waitForSelector(sel, { timeout: 45000 });
  await page.click(sel);
}
async function goLibrary() {
  const back = await page.$('#btn-back');
  if (back) { await back.click(); await sleep(1800); }
  if (!(await page.$('#asset-card-ak-47'))) {
    await page.goto(APP, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForSelector('#asset-card-ak-47', { timeout: 60000 });
    await sleep(2500);
  }
}

console.log('loading app...');
await page.goto(APP, { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForSelector('#asset-card-ak-47', { timeout: 60000 });
await sleep(2500);

// ---- AK-47 hero orbit
await clickSel('#asset-card-ak-47');
console.log('AK-47 loading...');
await sleep(10000);
await startRec('ak47');
await sleep(2000);
await cineOrbit(30000);
await sleep(1200);
await stopRec();

// ---- intelligence sweep -> annotations
await clickSel('#btn-sweep');
await startRec('sweep_start');
await sleep(7000);
await stopRec();

console.log('waiting for research...');
let ok = false;
for (let i = 0; i < 120; i++) {
  await sleep(3000);
  const st = await page.evaluate(() => ({
    parts: document.querySelectorAll('.parts-list > *').length,
    err: document.querySelector('.error-banner')?.textContent || null,
  }));
  if (st.parts > 0) { ok = true; break; }
  if (st.err) { console.log('research error:', st.err); break; }
  if (i % 10 === 0) console.log(`  ...${i * 3}s`);
}
console.log('researchOk =', ok);

if (ok) {
  await sleep(2500);
  await startRec('annotations');
  await sleep(2000);
  await cineOrbit(16000);
  await sleep(1000);
  await stopRec();
  await page.screenshot({ path: path.join(STILLS, 's2_intel.png') });

  await startRec('partfocus');
  await sleep(1200);
  const rows = await page.$$('.parts-list > *');
  for (const r of rows.slice(0, 4)) {
    await r.click().catch(() => {});
    await sleep(4200);
  }
  await sleep(1000);
  await stopRec();
}

// ---- tank
await goLibrary();
await clickSel('#asset-card-t-72a-obr-1980');
console.log('tank loading...');
await sleep(13000);
await startRec('tank');
await sleep(1500);
await cineOrbit(19000);
await sleep(800);
await stopRec();

// ---- jet
await goLibrary();
let jet = '#asset-card-sukhoi-su-57-felon-fighter-jet-free';
if (!(await page.$(jet))) jet = '#asset-card-jet-fighter';
await clickSel(jet);
console.log('jet loading...');
await sleep(13000);
await startRec('jet');
await sleep(1500);
await cineOrbit(17000);
await sleep(800);
await stopRec();

console.log('3D SCENES DONE');
await browser.close();
process.exit(0);
