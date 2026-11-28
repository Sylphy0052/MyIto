// #25 の画面確認: ホストとゲストの2クライアントで、候補表示・生成中表示・選択の反映を見る
// 使い方: node lobby-check.mjs <base URL> <screenshot dir>
import { launchChrome } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:47302';
const out = process.argv[3] ?? './shots';
mkdirSync(out, { recursive: true });

const browser = await launchChrome();
const results = [];
const check = (name, ok) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
};

async function enter(page, name, code) {
  await page.goto(base);
  await page.getByLabel('ニックネーム').fill(name);
  if (code) {
    await page.getByPlaceholder('ルームコード').fill(code);
    await page.getByRole('button', { name: '入室' }).click();
  } else {
    await page.getByRole('button', { name: 'ルームを作る' }).click();
  }
}

const host = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const guest = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();

await enter(host, 'ホスト');
await host.locator('.code').waitFor();
const code = ((await host.locator('.code').textContent()) ?? '').trim();
console.log('room code:', code);
await enter(guest, 'ゲスト', code);
await guest.getByText('ホストが開始するのを待っています').waitFor();

await guest.screenshot({ path: `${out}/01-guest-before.png` });
check('ゲストの画面にお題の本文が出る (ヘッダー)', ((await guest.locator('.topic-text').textContent()) ?? '').length > 0);

await host.getByRole('button', { name: /AIで\d+案生成/ }).click();
await guest.getByText('AIがお題を考えています').waitFor({ timeout: 3000 }).then(
  () => check('生成中の表示がゲストに出る (既存のnotice)', true),
  () => check('生成中の表示がゲストに出る (既存のnotice)', false),
);
await guest.screenshot({ path: `${out}/02-guest-busy.png` });

await guest.locator('.topic-candidates li').first().waitFor({ timeout: 10000 }).catch(() => {});
const guestCandidates = await guest.locator('.topic-candidates li').count();
check('ゲストに候補が5件出る', guestCandidates === 5);
check('ゲストの候補は選べない (button が無い)', (await guest.locator('.topic-candidates button').count()) === 0);
await guest.screenshot({ path: `${out}/03-guest-candidates.png` });
await host.screenshot({ path: `${out}/04-host-candidates.png` });

const second = host.locator('.topic-candidates button').nth(1);
const secondText = ((await second.textContent()) ?? '').trim();
await second.click();
await guest.locator('.candidate-static.selected').waitFor({ timeout: 3000 }).catch(() => {});
const selectedText = ((await guest.locator('.candidate-static.selected').first().textContent().catch(() => '')) ?? '').trim();
check(`ホストが選んだ候補がゲストで強調される (${secondText})`, selectedText.startsWith(secondText) && selectedText.includes('選択中'));
await guest.waitForTimeout(700);
check('ゲストのお題ヘッダーが選んだ候補になる', ((await guest.locator('.topic-text').textContent()) ?? '').trim() === secondText);
await guest.screenshot({ path: `${out}/05-guest-selected.png` });

// 再接続: ゲストをリロードしても一覧が戻る
await guest.reload();
await guest.getByText('ホストが開始するのを待っています').waitFor({ timeout: 5000 }).catch(() => {});
check('ゲストが再読込しても候補が出る', (await guest.locator('.topic-candidates li').count()) === 5);

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
