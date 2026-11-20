// 10の扉の1手番の制限時間を3クライアント (GM 1 + 回答者 2) で通す
// サーバは `DOORS_TURN_UNIT_MS=2000` で起動する (10秒を2秒に縮める。60秒 = 12秒)
// 流れ: 60秒設定 → 確定から数える → 届くと止まる → 取り消すと残りから再開 → GMが答えると満タンから数え直す
//       → 時間切れで回数を使い承認待ちが新しい順に取り消される → 回数を使い切ると最終解答へ (手番は出ない)
// 使い方: node doors-turn-check.mjs <base URL> <screenshot dir>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:47213';
const out = process.argv[3] ?? './shots-doors-turn';
mkdirSync(out, { recursive: true });

const TAG = `t${Date.now() % 100000}`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? `  (${detail})` : ''}`);
};
const until = (p) => p.then(() => true, () => false);

async function newClient(name, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.accept());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return Object.assign(page, { name_: name, errors_: errors });
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
const shotAll = async (step, pages) => {
  for (const p of pages) await p.screenshot({ path: `${out}/${step}-${p.name_}.png`, fullPage: true });
};
const overflowed = async (pages) => {
  const bad = [];
  for (const p of pages) {
    if (await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) bad.push(p.name_);
  }
  return bad;
};
const item = (p, t) => p.locator('li', { hasText: t });
async function propose(p, t) {
  await p.getByRole('radio', { name: '質問' }).click();
  await p.locator('.proposal-form input').first().fill(t);
  await p.locator('.proposal-form').getByRole('button', { name: '提案' }).click();
  await item(p, t).first().waitFor({ timeout: 5000 });
}
async function gmReply(gm, t, label) {
  const li = gm.locator('li', { hasText: t }).filter({ has: gm.locator('.reply-button') });
  await li.first().waitFor({ timeout: 5000 });
  await li.getByRole('button', { name: label, exact: true }).click();
  await li.first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
}
const turnText = async (p) => ((await p.locator('.turn-left').first().textContent().catch(() => '')) ?? '').trim();
const turnSec = async (p) => {
  const m = /(\d+):(\d{2})/.exec(await turnText(p));
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
};


const gm = await newClient('GM', 390);
const ra = await newClient('A', 320);
const rb = await newClient('B', 360);
const resp = [ra, rb];
const all = [gm, ra, rb];
const TIMEOUT_NOTICE = '手番の時間切れ。質問回数を1つ使いました';

// ---- ロビー: 1手番を60秒にする ----
await enter(gm);
await gm.locator('.code').waitFor();
const code = ((await gm.locator('.code').textContent()) ?? '').trim();
for (const p of resp) await enter(p, code);
for (const p of resp) await p.getByText('ホストが開始するのを待っています').waitFor({ timeout: 10000 });
await gm.getByRole('radio', { name: '10の扉' }).click();
const gmRow = gm.locator('.field-row', { hasText: 'GMの決め方' });
await gmRow.locator('select').first().selectOption('named');
await gmRow.locator('select').nth(1).selectOption({ label: 'GM' });
const qRow = gm.locator('.field-row', { hasText: '質問回数' });
await qRow.locator('select').first().selectOption('3');
const turnSelect = gm.locator('.field-row', { hasText: '1手番' }).locator('select');
const optionTexts = await turnSelect.locator('option').allTextContents();
const expectedOptions = ['なし', ...Array.from({ length: 18 }, (_, i) => `${(i + 1) * 10}秒`)].join(',');
check('1手番の選択肢は なし/10〜180秒 (10秒刻み)', optionTexts.join(',') === expectedOptions, `${optionTexts[0]},${optionTexts[1]},…,${optionTexts.at(-1)} (${optionTexts.length}件)`);
await turnSelect.selectOption('60');
check('回答者の設定一覧に「1手番: 60 秒」が出る', await until(ra.getByText('1手番: 60 秒').waitFor({ timeout: 5000 })));
await gm.getByPlaceholder('テーマを自由入力').fill('好きな動物');
await gm.locator('.field-row', { has: gm.getByPlaceholder('テーマを自由入力') }).getByRole('button', { name: '決定' }).click();
await gm.waitForTimeout(800);
await shotAll('01-lobby', all);

// ---- 答えの確定前は数えない ----
await gm.getByRole('button', { name: /^開始/ }).click();
await gm.locator('input[placeholder^="答え"]').waitFor({ timeout: 5000 });
await gm.waitForTimeout(1000);
check('答えを決める間は手番が出ない', (await gm.locator('.turn-left').count()) === 0 && (await ra.locator('.turn-left').count()) === 0);
await gm.locator('input[placeholder^="答え"]').fill('ペンギン');
await gm.getByRole('button', { name: '確定' }).click();
check('確定すると全員に手番が出る', (await Promise.all(all.map((p) => until(p.locator('.turn-left strong').first().waitFor({ timeout: 5000 }))))).every(Boolean));
const t0 = await turnText(ra);
check('手番は 0:12 以下から始まる (60秒 = 12秒)', /手番\s*0:(0\d|1[0-2])/.test(t0), t0);

// ---- 届くと止まる。取り消すと残りから再開する ----
const q1 = `生き物ですか? ${TAG}`;
await propose(ra, q1);
await item(rb, q1).getByRole('button', { name: 'OK', exact: true }).click();
await gm.locator('li', { hasText: q1 }).filter({ has: gm.locator('.reply-button') }).first().waitFor({ timeout: 5000 });
await gm.waitForTimeout(500);
check('提案が届くと全員の手番に「(GMの回答待ち)」が付く', (await Promise.all(all.map((p) => until(p.locator('.turn-left', { hasText: 'GMの回答待ち' }).waitFor({ timeout: 5000 }))))).every(Boolean));
const pausedSec = await turnSec(ra);
await ra.waitForTimeout(2500);
check('止まっている間は残りが減らない', (await turnSec(ra)) === pausedSec && (await turnSec(rb)) === pausedSec, `${pausedSec}s`);
await shotAll('02-paused', all);
await item(ra, q1).getByRole('button', { name: /取り消/ }).first().click();
check('取り消すと「(GMの回答待ち)」が消えて再開する', (await Promise.all(all.map((p) => until(p.locator('.turn-left', { hasText: 'GMの回答待ち' }).waitFor({ state: 'detached', timeout: 5000 }))))).every(Boolean));
await ra.waitForTimeout(1500);
const resumedSec = await turnSec(ra);
check('再開した残りは止まった残り以下 (満タンにならない)', resumedSec >= 0 && resumedSec < pausedSec && resumedSec < 12, `${pausedSec}s → ${resumedSec}s`);

// ---- GMが答えると満タンから数え直す ----
const q2 = `空を飛びますか? ${TAG}`;
await propose(ra, q2);
await item(rb, q2).getByRole('button', { name: 'OK', exact: true }).click();
await gm.waitForTimeout(500);
await gmReply(gm, q2, 'No');
await gm.waitForTimeout(500);
const refilled = await turnSec(ra);
check('GMが答えると満タン近く (10秒以上) から数え直す', refilled >= 10, `${refilled}s`);
check('数え直しているので「(GMの回答待ち)」は無い', (await ra.locator('.turn-left', { hasText: 'GMの回答待ち' }).count()) === 0);

// ---- 時間切れ: 承認待ちが残り回数を超えたら新しい順に取り消される ----
const p1 = `大きいですか? ${TAG}`;
const p2 = `海にいますか? ${TAG}`;
await propose(ra, p1);
await propose(ra, p2);
await shotAll('03-pending', all);
await ra.getByText(TIMEOUT_NOTICE).first().waitFor({ timeout: 20000 });
check('手番の時間切れの通知が全員に出る', (await Promise.all(all.map((p) => until(p.getByText(TIMEOUT_NOTICE).first().waitFor({ timeout: 5000 }))))).every(Boolean));
await shotAll('04-timeout1', all);
check('残り回数を超えた承認待ち (新しい方) は「(手番の時間切れ)」で取り消される', await until(item(rb, p2).getByText('(手番の時間切れ)').first().waitFor({ timeout: 5000 })));
check('古い方の承認待ちは残る', (await item(rb, p1).getByText('(手番の時間切れ)').count()) === 0);
check('時間切れのあと手番は満タン近くから数え直される', (await turnSec(ra)) >= 9, `${await turnSec(ra)}s`);

// ---- 回数を使い切ると最終解答へ。手番は出ない ----
await ra.getByText('最終解答を出す').first().waitFor({ timeout: 25000 });
check('回数を使い切ると最終解答の段階へ進む', true);
await shotAll('05-final', all);
check('古い方の承認待ちも「(手番の時間切れ)」で取り消される', await until(item(rb, p1).getByText('(手番の時間切れ)').first().waitFor({ timeout: 5000 })));
check('最終解答の段階では手番が出ない', (await Promise.all(all.map(async (p) => (await p.locator('.turn-left').count()) === 0))).every(Boolean));
await ra.waitForTimeout(14000);
check('最終解答の段階は、時間が過ぎても手番の時間切れにならない', (await ra.getByText('最終解答を出す').count()) === 1);
check('横あふれしない', (await overflowed(all)).length === 0, (await overflowed(all)).join(','));

// ---- 最終解答で終わらせ、結果画面に1手番を出す ----
await ra.getByRole('radio', { name: '解答' }).waitFor({ timeout: 3000 }).catch(() => {});
await ra.locator('.proposal-form input').first().fill('ペンギン');
await ra.locator('.proposal-form').getByRole('button', { name: '提案' }).click();
await item(rb, 'ペンギン').getByRole('button', { name: 'OK', exact: true }).click();
await gmReply(gm, 'ペンギン', '正解');
check('結果画面に「1手番: 60秒 (時間切れ 2回)」が出る', await until(ra.getByText('1手番: 60秒 (時間切れ 2回)').waitFor({ timeout: 10000 })));
await shotAll('06-result', all);

const errs = all.flatMap((p) => p.errors_);
check('ブラウザのエラーが無い', errs.length === 0, errs.join(' | ').slice(0, 200));
await browser.close();
const failed = results.filter((x) => !x).length;
console.log(failed === 0 ? `ALL PASS (${results.length})` : `${failed} FAIL / ${results.length}`);
process.exit(failed === 0 ? 0 : 1);
