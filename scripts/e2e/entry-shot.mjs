// ログイン画面のタイトルを、幅違いで撮り、はみ出しを調べる
import { launchChrome } from './lib.mjs';

const base = process.argv[2] ?? 'http://localhost:47304';
const out = process.argv[3] ?? './shots-entry';
import { mkdirSync } from 'node:fs';
mkdirSync(out, { recursive: true });
const browser = await launchChrome();
for (const width of [320, 360, 390, 1280]) {
  const page = await (await browser.newContext({ viewport: { width, height: 800 } })).newPage();
  await page.goto(base);
  await page.locator('h1').waitFor();
  await page.waitForTimeout(1200);
  const h1 = page.locator('h1');
  const box = await h1.boundingBox();
  const scrollW = await h1.evaluate((el) => el.scrollWidth);
  const clientW = await h1.evaluate((el) => el.clientWidth);
  const lines = await h1.evaluate((el) => {
    const tops = new Set([...el.querySelectorAll('span')].map((s) => Math.round(s.getBoundingClientRect().top)));
    return tops.size;
  });
  console.log(
    `width=${width} h1=${Math.round(box.width)}x${Math.round(box.height)} scrollW=${scrollW} clientW=${clientW} lines=${lines} text=${await h1.getAttribute('aria-label')}`,
  );
  await page.screenshot({ path: `${out}/entry-${width}.png` });
}
await browser.close();
