/**
 * E2E check that every library weapon opens an exploded view whose parts carry
 * REAL engineering names from the deep-research intel — not `Section 12`.
 *
 * Opens each asset through the app's own deep link (the same code path the
 * library "Explode" button uses, including the /api/asset-intel fetch), waits
 * for the intel to merge in, and reads the Component Sheet back off the screen.
 *
 *   node scripts/verify_library_intel.mjs                    (all assets)
 *   node scripts/verify_library_intel.mjs ak-47 t-72a-obr-1980 --shots
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = 'http://localhost:5173';
const SHOT_DIR = path.join(FRONTEND, '..', 'docs', 'exploded');

const argv = process.argv.slice(2);
const wantShots = argv.includes('--shots');
const only = new Set(argv.filter((a) => !a.startsWith('--')));

const assets = JSON.parse(
  fs.readFileSync(path.join(FRONTEND, 'src', 'assets_data.js'), 'utf8')
    .match(/=\s*(\[[\s\S]*\]);/)[1],
).filter((a) => a.url && (!only.size || only.has(a.id)));

// A label that still looks like this means the intel never landed on that part.
const GENERIC = /^(section|segment|part|body\s*parts?|c1|bolts|mesh|node|object)\b|^\d+$/i;

if (wantShots) fs.mkdirSync(SHOT_DIR, { recursive: true });

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle'] });
const results = [];

for (const asset of assets) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const url = `${BASE}/?glb=${encodeURIComponent(asset.url)}&name=${encodeURIComponent(asset.name)}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.waitForFunction(() => /components tracked/.test(document.body.innerText),
      { timeout: 120000 });

    // The intel fetch resolves after the model — wait for the researched
    // designation line (or give up and report what rendered without it).
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('#spec-panel > div');
      return rows.length > 1 && !!document.querySelector('#spec-panel');
    }, { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 12000)); // deep-research merge

    const sheet = await page.evaluate(() => {
      const panel = document.querySelector('#spec-panel');
      if (!panel) return null;
      const blocks = [...panel.children];
      const title = blocks[0]?.innerText || '';
      const rows = blocks.slice(1)
        .map((r) => r.innerText.split('\n').filter(Boolean))
        .filter((l) => l.length >= 2)
        .map((l) => ({ name: l[1], meta: l[2] || '' }));
      return { title, rows };
    });

    if (!sheet) throw new Error('no component sheet rendered');
    const designation = (sheet.title.split('\n')[2] || '').trim();
    const named = sheet.rows.filter((r) => !GENERIC.test(r.name.trim()));
    const generic = sheet.rows.filter((r) => GENERIC.test(r.name.trim()));

    if (wantShots) {
      await page.click('#btn-disassemble');
      await new Promise((r) => setTimeout(r, 4500));
      await page.screenshot({ path: path.join(SHOT_DIR, `${asset.id}.png`) });
    }

    results.push({
      id: asset.id, total: sheet.rows.length, named: named.length,
      designation, sample: named.slice(0, 5).map((r) => r.name).join(', '),
      generic: generic.map((r) => r.name).join(', '),
      errors: errors.length,
    });
    const flag = generic.length ? `  <-- ${generic.length} unnamed` : '';
    console.log(`${asset.id.padEnd(40)} ${String(named.length).padStart(2)}/${String(sheet.rows.length).padEnd(2)} named  ${designation.slice(0, 40)}${flag}`);
  } catch (e) {
    results.push({ id: asset.id, error: e.message });
    console.log(`${asset.id.padEnd(40)} FAILED: ${e.message}`);
  }
  await page.close();
}

await browser.close();

console.log('\n' + '='.repeat(96));
const ok = results.filter((r) => !r.error && r.named === r.total);
const partial = results.filter((r) => !r.error && r.named < r.total);
const failed = results.filter((r) => r.error);
for (const r of results.filter((x) => !x.error)) {
  console.log(`${r.id.padEnd(40)} ${r.sample.slice(0, 70)}`);
}
console.log('='.repeat(96));
console.log(`${ok.length} fully named · ${partial.length} partial · ${failed.length} failed  (of ${results.length})`);
if (partial.length) {
  for (const r of partial) console.log(`  partial ${r.id}: ${r.generic}`);
}
process.exit(failed.length ? 1 : 0);
