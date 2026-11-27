// 10の扉 (GM=プレイヤー指名) を3クライアントで通す。答えの漏えい、承認、回数、結果画面を見て、各画面を撮る
// 使い方: node doors-check.mjs <base URL> <screenshot dir> [reduced]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:47213';
const out = process.argv[3] ?? './shots-doors';
const reduced = process.argv[4] === 'reduced';
mkdirSync(out, { recursive: true });

const ANSWER = 'ペンギン';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const results = [];
const check = (name, ok) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
};

async function newClient(name) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  const frames = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
  page.frames_ = frames;
  page.name_ = name;
  return page;
}
async function enter(page, code) {
  await page.goto(base);
  await page.getByLabel('ニックネーム').fill(page.name_);
  if (code) {
    await page.getByPlaceholder('ルームコード').fill(code);
    await page.getByRole('button', { name: '入室' }).click();
  } else {
    await page.getByRole('button', { name: 'ルームを作る' }).click();
  }
}
const shot = (page, file) => page.screenshot({ path: `${out}/${file}.png` });

const host = await newClient('GMホスト');
const a = await newClient('回答者A');
const b = await newClient('回答者B');

await enter(host);
await host.locator('.code').waitFor();
const code = ((await host.locator('.code').textContent()) ?? '').trim();
await enter(a, code);
await enter(b, code);
await a.getByText('ホストが開始するのを待っています').waitFor();
await b.getByText('ホストが開始するのを待っています').waitFor();

// ロビー: 10の扉を選び、GMを指名する
await host.getByRole('radio', { name: '10の扉' }).click();
const gmRow = host.locator('.field-row', { hasText: 'GMの決め方' });
await gmRow.locator('select').first().selectOption('named');
await gmRow.locator('select').nth(1).selectOption({ label: 'GMホスト' });
await host.waitForTimeout(500);
await shot(host, '01-host-lobby');
await shot(a, '02-guest-lobby');
check('ゲストのロビーに10の扉の設定一覧が出る', ((await a.locator('body').textContent()) ?? '').includes('GM:'));

await host.getByRole('button', { name: /^開始/ }).click();
await host.locator('input[placeholder^="答え"]').waitFor({ timeout: 5000 });
await shot(host, '03-gm-setup');
await shot(a, '04-guest-setup');
await host.locator('input[placeholder^="答え"]').fill(ANSWER);
await host.getByRole('button', { name: '確定' }).click();
await a.getByText(/残り\s*10\s*\/\s*10/).first().waitFor({ timeout: 5000 }).catch(() => {});
await a.waitForTimeout(800);
await shot(a, '05-guest-asking');
await shot(host, '06-gm-asking');
check('途中まで、GM以外へ送られた通信に答えが含まれない', ![...a.frames_, ...b.frames_].some((f) => f.includes(ANSWER)));

// 質問 → 承認 → GMの回答
await a.locator('input[placeholder^="例"]').fill('生き物ですか?');
await a.getByRole('button', { name: '提案' }).click();
await b.getByRole('button', { name: 'OK', exact: true }).waitFor({ timeout: 5000 });
await shot(b, '07-guest-pending');
check('提案者本人にはOKボタンが出ない', (await a.getByRole('button', { name: 'OK', exact: true }).count()) === 0);
check('承認前の提案はGMの列に届かない', (await host.locator('.reply-button').count()) === 0);
await b.getByRole('button', { name: 'OK', exact: true }).click();
await host.locator('.reply-button.tone-ok').first().waitFor({ timeout: 5000 });
await shot(host, '08-gm-queue');
await host.locator('.reply-button.tone-ok').first().click();
await a.getByText(/残り\s*9\s*\/\s*10/).first().waitFor({ timeout: 5000 }).then(
  () => check('回答されると残り回数が1減る', true),
  () => check('回答されると残り回数が1減る', false),
);
await a.waitForTimeout(600);
await shot(a, '09-guest-replied');

// 解答 → 承認 → 正解
await a.getByRole('radio', { name: '解答' }).click();
await a.locator('input[placeholder^="答え"]').fill(ANSWER);
await a.getByRole('button', { name: '提案' }).click();
await b.getByRole('button', { name: 'OK', exact: true }).click();
await host.locator('.reply-button.tone-ok').first().waitFor({ timeout: 5000 });
await host.getByRole('button', { name: /正解/ }).filter({ hasNotText: '不正解' }).first().click();
await a.getByText('結果').first().waitFor({ timeout: 5000 }).catch(() => {});
await a.waitForTimeout(1500);
await shot(a, '10-guest-result');
await shot(host, '11-gm-result');
const result = (await a.locator('body').textContent()) ?? '';
check('結果画面で答えが全員に公開される', result.includes(ANSWER));
check('itoの文言 (全部正しい順番でした) が出ない', !result.includes('全部正しい順番'));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed (${reduced ? 'reduced-motion' : 'normal'})`);
process.exit(failed ? 1 : 0);
