// 10の扉の制限時間を3クライアント (GM 1 + 回答者 2) で通す
// サーバは `DOORS_MINUTE_MS=4000` で起動する (1分を4秒に縮める。3分 = 12秒)
// 流れ: 3分設定 → 答えの確定から数える → 時間切れで承認待ちが取り消され新規提案が断られる → GMが答えると最終解答へ
//       → 「時間 +1分」で質問へ戻る → 回数を使い切った最終解答の段階では締切を過ぎても時間切れの案内が出ない
// 使い方: node doors-time-check.mjs <base URL> <screenshot dir>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:47213';
const out = process.argv[3] ?? './shots-doors-time';
mkdirSync(out, { recursive: true });

const MINUTE_MS = 4000;
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
const timeLeftText = async (p) => ((await p.locator('.time-left').first().textContent().catch(() => '')) ?? '').trim();

const gm = await newClient('GM', 390);
const ra = await newClient('A', 320);
const rb = await newClient('B', 360);
const resp = [ra, rb];
const all = [gm, ra, rb];

// ---- ロビー: 制限時間を3分にする ----
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
await qRow.locator('select').first().selectOption('2');
const optionTexts = await qRow.locator('select').last().locator('option').allTextContents();
const expectedOptions = ['なし', ...Array.from({ length: 60 }, (_, i) => `${i + 1}分`)].join(',');
check('制限時間の選択肢は なし/1〜60分 (1分刻み)', optionTexts.join(',') === expectedOptions, `${optionTexts[0]},${optionTexts[1]},…,${optionTexts.at(-1)} (${optionTexts.length}件)`);
await qRow.locator('select').last().selectOption('7');
check('1分刻みの値 (7分) を選ぶと回答者の設定一覧に出る', await until(ra.getByText('制限時間: 7 分').waitFor({ timeout: 5000 })));
await qRow.locator('select').last().selectOption('3');
await gm.getByPlaceholder('テーマを自由入力').fill('好きな動物');
await gm.locator('.field-row', { has: gm.getByPlaceholder('テーマを自由入力') }).getByRole('button', { name: '決定' }).click();
await gm.waitForTimeout(800);
check('回答者の設定一覧に「制限時間: 3 分」が出る', await until(ra.getByText('制限時間: 3 分').waitFor({ timeout: 5000 })));
await shotAll('01-lobby', all);

// ---- 答えの確定前は時間を数えない ----
await gm.getByRole('button', { name: /^開始/ }).click();
await gm.locator('input[placeholder^="答え"]').waitFor({ timeout: 5000 });
await gm.waitForTimeout(1500);
check('答えを決める間は残り時間が出ない', (await gm.locator('.time-left').count()) === 0 && (await ra.locator('.time-left').count()) === 0);
await gm.locator('input[placeholder^="答え"]').fill('ペンギン');
await gm.getByRole('button', { name: '確定' }).click();
const startedAt = Date.now();
check('確定すると全員に残り時間が出る', (await Promise.all(all.map((p) => until(p.locator('.time-left strong').first().waitFor({ timeout: 5000 }))))).every(Boolean));
const t0 = await timeLeftText(ra);
check('残り時間は 0:12 以下から始まる (3分 = 12秒)', /残り\s*0:(0\d|1[0-2])/.test(t0), t0);

// ---- 時間切れの前に、届いた質問と承認待ちの質問を作る ----
const q1 = `生き物ですか? ${TAG}`;
const q2 = `空を飛びますか? ${TAG}`;
await propose(ra, q1);
await item(rb, q1).getByRole('button', { name: 'OK', exact: true }).click();
await gm.locator('li', { hasText: q1 }).filter({ has: gm.locator('.reply-button') }).first().waitFor({ timeout: 5000 });
await propose(ra, q2);
await shotAll('02-running', all);
check('全員の残り時間が近い値 (差 2 秒以内)', await (async () => {
  const secs = await Promise.all(all.map(async (p) => {
    const m = /(\d+):(\d+)/.exec(await timeLeftText(p));
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  }));
  return Math.max(...secs) - Math.min(...secs) <= 2;
})());
check('進行中に横あふれしない', (await overflowed(all)).length === 0, (await overflowed(all)).join(','));

// ---- 時間切れ ----
await ra.getByText('時間切れ。最終解答へ進みます').first().waitFor({ timeout: 20000 });
check('時間切れの案内が全員に出る', (await Promise.all(all.map((p) => until(p.getByText('時間切れ。最終解答へ進みます').first().waitFor({ timeout: 5000 }))))).every(Boolean));
console.log(`  (確定から ${Math.round((Date.now() - startedAt) / 100) / 10} 秒)`);
await shotAll('03-time-up', all);
check('承認待ちの質問は「(時間切れ)」で取り消される', await until(item(rb, q2).getByText('(時間切れ)').first().waitFor({ timeout: 5000 })));
check('時間切れのあと、新しい質問はサーバに断られて出ない', await (async () => {
  await ra.getByRole('radio', { name: '質問' }).click();
  await ra.locator('.proposal-form input').first().fill(`断られる質問 ${TAG}`);
  await ra.locator('.proposal-form').getByRole('button', { name: '提案' }).click();
  await ra.waitForTimeout(800);
  return (await item(ra, `断られる質問 ${TAG}`).count()) === 0;
})());
check('届いている質問が残るので、まだ最終解答には進まない', (await ra.getByText(/最終解答を出す/).count()) === 0);

// ---- GMが答えると最終解答へ ----
await gmReply(gm, q1, 'Yes');
check('届いていた質問に答えると最終解答の段階へ進む', await until(ra.getByText('最終解答を出す').first().waitFor({ timeout: 5000 })));
check('「時間切れのため、質問へ戻るには…」の案内がGMに出る', await until(gm.getByText(/質問へ戻るには「時間 \+1分」/).first().waitFor({ timeout: 5000 })));
await shotAll('04-final', all);

// ---- 時間 +1分 で質問へ戻る (回数 1/2 が残っている) ----
await gm.getByRole('button', { name: '延長 +1' }).click();
await gm.waitForTimeout(600);
check('時間切れの間に「延長 +1」(回数) を押しても、質問へは戻らない', (await ra.getByText('最終解答を出す').count()) === 1);
await gm.getByRole('button', { name: '時間 +1分' }).click();
// 段階の切り替えは退場アニメーションを待つ (mode="wait") ので、最終解答の見出しが消えるまで待つ
check('「時間 +1分」で質問の段階へ戻り、残り時間が出る', await until(ra.locator('.time-left strong').first().waitFor({ timeout: 5000 })) && await until(ra.getByText('最終解答を出す').first().waitFor({ state: 'detached', timeout: 3000 })));
const leftSec = async (p) => {
  const m = (await timeLeftText(p)).match(/(\d+):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
};
const beforeExtend = await leftSec(ra);
// 後の q3・q4 の提案と回答を締切までに終えられるよう、8回延ばして余裕を持たせる (残りはおよそ 36 秒)
const EXTEND_TIMES = 8;
for (let i = 0; i < EXTEND_TIMES; i += 1) {
  await gm.getByRole('button', { name: '時間 +1分' }).click();
  await gm.waitForTimeout(300);
}
const afterExtend = await leftSec(ra);
// 8回で 32 秒延びる (1分 = 4秒)。押す間の経過 (1回およそ0.5秒) と表示の丸めを見込んで 24 秒以上増えていればよい
check(`「時間 +1分」を${EXTEND_TIMES}回押すと、全員の残り時間が延びる`, afterExtend - beforeExtend >= 24, `${beforeExtend}s → ${afterExtend}s`);
await shotAll('05-extended', all);

// ---- 回数を使い切って最終解答の段階へ。締切を過ぎても時間切れの案内は出ない ----
const q3 = `大きいですか? ${TAG}`;
const q4 = `海にいますか? ${TAG}`;
await propose(ra, q3);
await item(rb, q3).getByRole('button', { name: 'OK', exact: true }).click();
await gmReply(gm, q3, 'No');
await propose(ra, q4);
await item(rb, q4).getByRole('button', { name: 'OK', exact: true }).click();
await gmReply(gm, q4, 'Yes');
check('回数を使い切ると最終解答の段階へ進む', await until(ra.getByText('最終解答を出す').first().waitFor({ timeout: 5000 })));
const noticeBefore = await ra.getByText('時間切れ。最終解答へ進みます').count();
// 延長のあとの残りは最大でおよそ 36 秒 (4秒 + 32秒)。それより長く待って締切を確実に過ぎる
await ra.waitForTimeout(MINUTE_MS * 10);
check('最終解答の段階で締切を過ぎても、時間切れの案内は出ない', noticeBefore === 0 && (await ra.getByText('時間切れ。最終解答へ進みます').count()) === 0 && (await ra.locator('.time-left').count()) === 0);
await shotAll('06-final-after-deadline', all);

// ---- 終了 ----
await ra.getByRole('radio', { name: '解答' }).waitFor({ timeout: 3000 }).catch(() => {});
await ra.locator('.proposal-form input').first().fill('ペンギン');
await ra.locator('.proposal-form').getByRole('button', { name: '提案' }).click();
await item(rb, 'ペンギン').getByRole('button', { name: 'OK', exact: true }).click();
await gmReply(gm, 'ペンギン', '正解');
check('最終解答が正解なら回答者の勝ちで終わる', await until(ra.getByText('回答者の勝ち').first().waitFor({ timeout: 8000 })));
check('結果画面に制限時間と時間切れが出る', await until(ra.getByText('制限時間: 3分 (時間切れあり)').first().waitFor({ timeout: 5000 })));
await shotAll('07-result', all);
check('結果画面で横あふれしない', (await overflowed(all)).length === 0, (await overflowed(all)).join(','));

// ---- 制限時間ありのラウンドを中止すると、締切を過ぎても結果画面のまま ----
// 画面の動きを確かめる検査。中止でタイマーを止め忘れても、発火時の確認 (同じラウンドかつ質問の段階か) で何も起きないので、
// タイマーの止め忘れそのものはこの検査では見分けられない

async function startRound() {
  await gm.getByRole('button', { name: /^開始/ }).click();
  await gm.locator('input[placeholder^="答え"]').waitFor({ timeout: 5000 });
  await gm.locator('input[placeholder^="答え"]').fill('ペンギン');
  await gm.getByRole('button', { name: '確定' }).click();
}
await gm.getByRole('button', { name: /ロビーに戻る/ }).click();
await gm.getByRole('button', { name: /^開始/ }).waitFor({ timeout: 5000 });
await startRound();
check('2ラウンド目も確定すると残り時間が出る', await until(ra.locator('.time-left strong').first().waitFor({ timeout: 5000 })));
await gm.getByRole('button', { name: '中止して答えを公開 (ロビーへ)' }).click();
check('中止すると結果画面になる', await until(ra.getByText('中止 (ホストが中止しました)').first().waitFor({ timeout: 5000 })));
await ra.waitForTimeout(MINUTE_MS * 3 + 2000);
check(
  '中止のあと締切を過ぎても、結果画面のまま時間切れの案内も出ない',
  (await ra.getByText('中止 (ホストが中止しました)').count()) > 0 &&
    (await ra.getByText('最終解答を出す').count()) === 0 &&
    (await ra.getByText('時間切れ。最終解答へ進みます').count()) === 0 &&
    (await ra.locator('.time-left').count()) === 0,
);
await shotAll('08-aborted', all);

// ---- 制限時間なしなら残り時間も「時間 +1分」も出ない ----
await gm.getByRole('button', { name: /ロビーに戻る/ }).click();
await gm.getByRole('button', { name: /^開始/ }).waitFor({ timeout: 5000 });
await gm.locator('.field-row', { hasText: '質問回数' }).locator('select').last().selectOption('0');
await gm.waitForTimeout(500);
await startRound();
await ra.locator('.proposal-form').waitFor({ timeout: 5000 });
await gm.waitForTimeout(1000);
check(
  '制限時間なしなら残り時間も「時間 +1分」も出ない',
  (await ra.locator('.time-left').count()) === 0 && (await gm.locator('.time-left').count()) === 0 && (await gm.getByRole('button', { name: '時間 +1分' }).count()) === 0,
);
await shotAll('09-no-limit', all);
await gm.getByRole('button', { name: '中止して答えを公開 (ロビーへ)' }).click();
await ra.getByText('中止 (ホストが中止しました)').first().waitFor({ timeout: 5000 }).catch(() => {});

const errs = all.flatMap((p) => p.errors_.map((e) => `${p.name_}: ${e}`));
check('どのクライアントでもページのエラーが出ない', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
