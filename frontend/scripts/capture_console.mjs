// Loads the viewer deep-link headlessly and prints matching console lines.
//   node scripts/capture_console.mjs <glbUrl> <name> [filter]   (from frontend/)
import puppeteer from 'puppeteer';

const [glb, name, filter = '[dbg'] = process.argv.slice(2);
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
page.on('console', (msg) => {
  const t = msg.text();
  if (t.includes(filter)) console.log(t);
});
await page.goto(`http://localhost:5173/?glb=${encodeURIComponent(glb)}&name=${encodeURIComponent(name)}`,
  { waitUntil: 'networkidle0', timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await browser.close();
