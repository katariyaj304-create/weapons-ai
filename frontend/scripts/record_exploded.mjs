/**
 * record_exploded.mjs — records the exploded-assembly module using only the
 * best-looking models: the artist-grade M4 modular kit (26 textured named parts),
 * AS VAL (21 named parts), and the AK-47.
 *
 * Writes: build/rec/{exp_m4, exp_val, exp_ak} and build/stills/s5_exploded.png
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
  const s = r.meta.length ? (r.meta[r.meta.length - 1] - r.meta[0]).toFixed(1) : 0;
  console.log(`[rec] stopped — ${r.idx} frames, ${s}s`);
}

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
const CX = 880, CY = 520;

async function slowOrbit(ms) {
  const leg = ms / 2;
  await drag(CX, CY, CX + 130, CY - 15, leg);
  await sleep(200);
  await drag(CX, CY, CX - 120, CY + 18, leg);
  await sleep(200);
}

// Wait for the exploded viewer's controls to mount (model parsed + parts detected)
async function waitViewer(ms = 180000) {
  await page.waitForSelector('#btn-disassemble', { timeout: ms });
  await sleep(3500); // let the model settle / textures upload
}

async function explodeShow(label, orbitMs, withSheet) {
  await page.click('#btn-disassemble');
  await sleep(4200);              // watch the cascade play out
  await slowOrbit(orbitMs);
  if (withSheet) {
    const sheet = await page.$('#spec-panel-toggle');
    if (sheet) {
      await sheet.click();
      await sleep(3200);          // component sheet: numbered rows, tiers, dims
      await page.screenshot({ path: path.join(STILLS, 's5_exploded.png') });
      await sleep(1500);
    }
  }
  console.log(`  ${label} exploded`);
}

// ---------- 1) M4 MODULAR KIT — artist-grade, 26 textured named parts ----------
const M4 = '/uploads/a0833ba9_free_-_m4_modular_kit_gun.glb';
console.log('loading M4 modular kit (86MB, may take a while)...');
await page.goto(`${APP}/?glb=${encodeURIComponent(M4)}&name=${encodeURIComponent('M4 Modular Kit')}`,
  { waitUntil: 'networkidle2', timeout: 120000 });
await waitViewer();
await startRec('exp_m4');
await sleep(2200);
await explodeShow('M4 kit', 13000, true);
await sleep(1200);
await stopRec();

// ---------- 2) AS VAL — 21 real named parts from the library ----------
console.log('AS VAL...');
await page.goto(APP, { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForSelector('#asset-card-as_val', { timeout: 60000 });
await sleep(2000);
await page.click('#btn-explode-as_val');
await waitViewer();
await startRec('exp_val');
await sleep(2000);
await explodeShow('AS VAL', 11000, false);
await sleep(1000);
await stopRec();

// ---------- 3) AK-47 ----------
console.log('AK-47...');
await page.goto(APP, { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForSelector('#asset-card-ak-47', { timeout: 60000 });
await sleep(2000);
await page.click('#btn-explode-ak-47');
await waitViewer();
await startRec('exp_ak');
await sleep(2000);
await explodeShow('AK-47', 10000, false);
await sleep(1000);
await stopRec();

console.log('EXPLODED SCENES DONE');
await browser.close();
process.exit(0);
