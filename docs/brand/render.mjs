// Regenerates docs/brand/n8n-wordmark-{light,dark}.png from wordmark.html.
// Usage: npm install playwright && node docs/brand/render.mjs
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(outDir, 'wordmark.html');

const variants = [
  { name: 'light', color: '#A371F7', file: 'n8n-wordmark-light.png' }, // verbatim repo brand hex, for white bg
  { name: 'dark',  color: '#cbaefa', file: 'n8n-wordmark-dark.png' },  // same hue, lightened tint for near-black bg legibility
];

const browser = await chromium.launch();
for (const v of variants) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 320 } });
  await page.goto('file://' + htmlPath);
  await page.evaluate((color) => {
    document.getElementById('mark').style.color = color;
  }, v.color);
  await page.waitForTimeout(50);
  await page.screenshot({ path: path.join(outDir, v.file), omitBackground: true });
  await page.close();
}
await browser.close();
console.log('done');
