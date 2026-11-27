// 10の扉 (AI GM) を1クライアントで通し、返答・失敗表示・再試行・取り消し・結果画面を見て、各画面を撮る
// 使い方: node ai-gm-check.mjs <base URL> <screenshot dir>
// サーバは mock-ask-doors.mjs に向けて起動しておく (ASK_API_URL=http://localhost:47301、ダミーのキーとプロジェクト)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:47213';
const out = process.argv[3] ?? './shots-ai-gm';
mkdirSync(out, { recursive: true });

const ANSWER = 'ペンギン';
// モックは同じ質問を2回目から成功させるので、再実行しても失敗するよう質問文に実行ごとの印を付ける
const TAG = Date.now().toString(36);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const frames = [];
page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
const check = (name, ok) => console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`) || ok;
const results = [];
const rec = (name, ok) => results.push(check(name, ok));
const shot = (file) => page.screenshot({ path: `${out}/${file}.png`, fullPage: true });
const body = async () => (await page.locator('body').textContent()) ?? '';
const waitText = (t, timeout = 15000, exact = false) => page.getByText(t, { exact }).first().waitFor({ timeout }).then(() => true, () => false);
// 回答バッジ (Yes/No など) だけを見る。画面のほかの場所の文字に釣られないようにする
const waitBadge = (re, timeout = 15000) => page.locator('.reply-badge', { hasText: re }).first().waitFor({ timeout }).then(() => true, () => false);
const retryBtn = () => page.getByRole("button", { name: "再試行" });
const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
async function propose(kind, text) {
  await page.getByRole('radio', { name: kind === 'question' ? '質問' : '解答', exact: true }).click();
  await page.locator('.proposal-form input').fill(text);
  await page.getByRole('button', { name: '提案', exact: true }).click();
}

await page.goto(base);
await page.getByLabel('ニックネーム').fill('試験者');
await page.getByRole('button', { name: 'ルームを作る' }).click();
await page.locator('.code').waitFor();
await page.getByRole('radio', { name: '10の扉' }).click();
await page.locator('.field-row', { hasText: 'GMの決め方' }).locator('select').first().selectOption('ai');
await page.getByPlaceholder('テーマを自由入力').fill('好きな動物');
await page.getByRole('button', { name: '決定' }).click();
await page.waitForTimeout(500);
await shot('01-lobby');
rec('ロビーにAIのモデル選択が出る', (await body()).includes('AIのモデル'));
await page.getByRole('button', { name: /^開始/ }).click();

rec('答えが決まって「残り 10 / 10」になる', await waitText(/残り\s*10\s*\/\s*10/, 30000));
await shot('02-asking');
rec('出題中、受け取った通信に答えが含まれない', !frames.some((f) => f.includes(ANSWER)));
rec('出題中、画面に答えが出ない', !(await body()).includes(ANSWER));

// 1. 普通の質問に、返答が付く
await propose('question', '鳥ですか?');
rec('質問に回答 (Yes) が付く', await waitBadge(/\bYes\b/));
await shot('03-answered');

// 2. 失敗した提案: 失敗ラベル、ほかの提案は順番待ち、取り消すと失敗の表示が消える
await propose('question', `失敗する質問ですか? ${TAG}`);
rec('失敗の通知が出て、再試行ボタンがある', await retryBtn().waitFor({ timeout: 15000 }).then(() => true, () => false));
await propose('question', '生き物ですか?');
await page.waitForTimeout(500);
await shot('04-failed');
rec('失敗した提案に「AIの応答に失敗」が出る', (await body()).includes('AIの応答に失敗 (ホストが再試行できます)'));
rec('ほかの送信済みの提案は「AIの順番待ち」のまま', (await page.locator('li', { hasText: '生き物ですか?' }).getByText('AIの順番待ち').count()) > 0);
rec('失敗表示中もスマホ幅で横あふれしない', !(await overflow()));
await page
  .locator('li', { hasText: `失敗する質問ですか? ${TAG}` })
  .getByRole('button', { name: '取り消し' })
  .click();
await page.waitForTimeout(800);
await shot('05-after-cancel');
{
  // 取り消した提案は退場アニメーションのあとで消える。固定時間ではなく、消えるまで待って見る
  const labelGone = await page.getByText('(ホストが再試行できます)').first().waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false);
  const alerts = await page.locator('.ai-error').count();
  console.log(`  詳細: ラベルが消えた=${labelGone} .ai-error数=${alerts}`);
  rec('失敗した提案を取り消すと、失敗の通知と表示が消える', labelGone && alerts === 0);
}
rec('取り消しのあと、順番待ちだった質問にAIが回答する', await waitBadge(/\bNo\b/));

// 3. 再試行: 1回目は失敗、再試行で回答が付く
await propose('question', `失敗その2 ${TAG} 鳥の仲間ですか?`);
rec('2件目の失敗でも再試行ボタンが出る', await retryBtn().waitFor({ timeout: 15000 }).then(() => true, () => false));
await retryBtn().click();
rec('再試行すると失敗の通知が消える', await retryBtn().waitFor({ state: 'detached', timeout: 15000 }).then(() => true, () => false));
await page.waitForTimeout(1500);
await shot('06-after-retry');
rec('再試行後の表示に「AIの応答に失敗」が残らない', !(await body()).includes('(ホストが再試行できます)') && (await page.locator('.ai-error').count()) === 0);

// 3b. 立ち絵: 1280x800で、回答の種類ごとの表情と漫符を撮る (モックはキーワードで unknown / maybe-yes / maybe-no を返す)
await page.setViewportSize({ width: 1280, height: 800 });
for (const [file, text, badge] of [
  ['06a-portrait-unknown', `わからない ${TAG} 質問ですか?`, '分からない'],
  ['06b-portrait-maybe-yes', `たぶん鳥 ${TAG} ですか?`, 'どちらかといえばYes'],
  ['06c-portrait-maybe-no', `たぶん違う ${TAG} ですか?`, 'どちらかといえばNo'],
]) {
  await propose('question', text);
  // 前の質問の回答バッジを拾わないよう、この質問の行の中だけで待つ
  rec(`立ち絵確認: ${file} の質問に回答が付く`, await page.locator('li', { hasText: text }).locator('.reply-badge', { hasText: badge }).first().waitFor({ timeout: 15000 }).then(() => true, () => false));
  await page.waitForTimeout(400); // 動きと漫符が出ている間に撮る
  await page.screenshot({ path: `${out}/${file}.png` });
  await page.waitForTimeout(1500);
}
await page.setViewportSize({ width: 390, height: 844 });

// 4. 解答: 不正解 / おしい / 正解
await propose('guess', 'フラミンゴ');
rec('解答が不正解になる', await waitText('不正解'));
await propose('guess', '鳥');
rec('解答が「おしい」になる', await waitText('おしい'));
await shot('07-guesses');
await propose('guess', ANSWER);
// 解答の履歴にも「ペンギン」が出るので、文字ではなく提案欄が消える (ゲーム終了) ことで見る
rec('正解するとゲームが終わり、提案欄が消える', await page.locator('.proposal-form').waitFor({ state: 'detached', timeout: 20000 }).then(() => true, () => false));
// 結果画面の答えの札だけを見る (履歴の「ペンギン」と取り違えない)。見た目は撮った画像で確認する
const revealed = page.locator('.doors-result .answer-reveal .secret-card');
rec('結果画面の答えの札に正解が出る', await revealed.waitFor({ timeout: 10000 }).then(async () => (await revealed.innerText()).trim() === ANSWER, () => false));
await page.waitForTimeout(1500);
await shot('08-result');
rec('結果画面もスマホ幅で横あふれしない', !(await overflow()));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
