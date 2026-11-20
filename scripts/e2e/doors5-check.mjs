// 10の扉 (GM=プレイヤー指名) を5クライアント (GM 1 + 回答者 4) で通す
// 設定: 質問3回・嘘1回・テーマ自由入力。並行提案、全員OKの承認、取り消し、Yes/嘘/不正解/却下/おしい、GMの訂正 (嘘の付け外し・解答)、延長依頼と延長、確認ダイアログ、最終解答で正解
// 使い方: node doors5-check.mjs <base URL> <screenshot dir>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:47213';
const out = process.argv[3] ?? './shots-doors5';
mkdirSync(out, { recursive: true });

const ANSWER = 'ペンギン';
const THEME = '好きな動物';
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
  const frames = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
  page.on('dialog', (d) => {
    page.dialogs_.push(d.message());
    if (page.dismissNext_) {
      page.dismissNext_ = false;
      void d.dismiss();
    } else void d.accept();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return Object.assign(page, { name_: name, frames_: frames, errors_: errors, dialogs_: [], dismissNext_: false });
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
const text = async (p) => (await p.locator('body').textContent()) ?? '';
const item = (p, t) => p.locator('li', { hasText: t });

async function propose(p, kind, t) {
  if (kind) await p.getByRole('radio', { name: kind === 'guess' ? '解答' : '質問' }).click();
  await p.locator('.proposal-form input').first().fill(t);
  await p.locator('.proposal-form').getByRole('button', { name: '提案' }).click();
  await item(p, t).first().waitFor({ timeout: 5000 });
}
const approve = (p, t) => item(p, t).getByRole('button', { name: 'OK', exact: true }).click();
/** 提案者以外の回答者全員がOKする。最後の1人のOKで届く */
async function approveAll(author, t) {
  for (const p of resp) if (p !== author) await approve(p, t);
}
const logItem = (p, t) => p.locator('.doors-log li', { hasText: t });
async function gmCorrect(t, label, lie) {
  const li = logItem(gm, t);
  await li.getByRole('button', { name: '訂正', exact: true }).click();
  const box = li.locator('.correct-panel');
  if (lie !== undefined) await box.getByLabel(/嘘をつく/).setChecked(lie);
  await box.getByRole('button', { name: label, exact: true }).click();
}
async function gmReply(gm, t, label, isLie = false) {
  const li = gm.locator('li', { hasText: t }).filter({ has: gm.locator('.reply-button') });
  await li.first().waitFor({ timeout: 5000 });
  if (isLie) await li.getByLabel(/嘘をつく/).check();
  await li.getByRole('button', { name: label, exact: true }).click();
  await li.first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
}
const remainingIs = (p, n, total) => until(p.getByText(new RegExp(`残り\\s*${n}\\s*/\\s*${total}`)).first().waitFor({ timeout: 5000 }));

// 幅はスマホ3種とPCを混ぜる
const gm = await newClient('GM', 390);
const ra = await newClient('A', 360);
const rb = await newClient('B', 390);
const rc = await newClient('C', 320);
const rd = await newClient('D', 1280);
const resp = [ra, rb, rc, rd];
const all = [gm, ...resp];

// ---- ロビー ----
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
await qRow.locator('select').nth(1).selectOption('1');
await gm.getByPlaceholder('テーマを自由入力').fill(THEME);
await gm.locator('.field-row', { has: gm.getByPlaceholder('テーマを自由入力') }).getByRole('button', { name: '決定' }).click();
await gm.waitForTimeout(800);
await shotAll('01-lobby', all);
{
  const t = await text(rc);
  check('回答者のロビーに設定 (GM・質問回数・嘘・テーマ) が出る', t.includes('GM:') && t.includes('3') && t.includes('最大 1 回') && t.includes(THEME));
}
check('ロビーで横あふれしない', (await overflowed(all)).length === 0, (await overflowed(all)).join(','));

// ---- GMの答え ----
await gm.getByRole('button', { name: /^開始/ }).click();
await gm.locator('input[placeholder^="答え"]').waitFor({ timeout: 5000 });
await rb.waitForTimeout(500);
await shotAll('02-setup', all);
check('答えを決める前、回答者は提案できない', (await ra.locator('.proposal-form input').count()) === 0 || (await ra.locator('.proposal-form button[disabled]').count()) > 0);
await gm.locator('input[placeholder^="答え"]').fill(ANSWER);
await gm.getByRole('button', { name: '確定' }).click();
check('全員の画面が「残り 3 / 3」になる', (await Promise.all(resp.map((p) => remainingIs(p, 3, 3)))).every(Boolean));

// ---- 取り消し: Dの提案をCが取り消す ----
const qCancel = `取り消す質問 ${TAG}`;
await propose(rd, 'question', qCancel);
await item(rc, qCancel).getByRole('button', { name: '取り消し' }).click();
check('他人の提案を取り消すと全員の画面から消える', (await Promise.all(resp.map((p) => until(item(p, qCancel).locator('button').first().waitFor({ state: 'detached', timeout: 5000 }))))).every(Boolean));

// ---- 並行提案と承認 ----
const q1 = `生き物ですか? ${TAG}`;
const q2 = `空を飛びますか? ${TAG}`;
const g1 = `ライオン ${TAG}`;
await propose(ra, 'question', q1);
await propose(rb, 'question', q2);
await propose(rc, 'guess', g1);
await rd.waitForTimeout(500);
await shotAll('03-pending', all);
check('提案者本人にはOKが出ず、他の回答者には出る',
  (await item(ra, q1).getByRole('button', { name: 'OK', exact: true }).count()) === 0 &&
  (await item(rb, q1).getByRole('button', { name: 'OK', exact: true }).count()) === 1 &&
  (await item(rd, g1).getByRole('button', { name: 'OK', exact: true }).count()) === 1);
check('承認前の提案はGMの列に届かない', (await gm.locator('.reply-button').count()) === 0);
check('回数を超える4件目は出せない', await (async () => {
  await rd.getByRole('radio', { name: '質問' }).click();
  await rd.locator('.proposal-form input').first().fill('4件目');
  const disabled = await rd.locator('.proposal-form').getByRole('button', { name: '提案' }).isDisabled();
  await rd.locator('.proposal-form input').first().fill('');
  return disabled || (await text(rd)).includes('残り回数');
})());
// q1: 3人中1人だけOK → 札は 1/3 でGMには届かない。OK済みの人にOKボタンは出ない
await approve(rd, q1);
await rb.waitForTimeout(500);
check('1人OKでは届かず、札に 1/3 とOKした人の名前が全員に出る',
  (await Promise.all([ra, rb, rc].map((p) => until(item(p, q1).getByText(/1\/3.*OK: D/).first().waitFor({ timeout: 5000 }))))).every(Boolean) &&
  (await gm.locator('.reply-button').count()) === 0);
check('OK済みのDにはOKボタンが出ず「OK済み」が出る',
  (await item(rd, q1).getByRole('button', { name: 'OK', exact: true }).count()) === 0 && (await item(rd, q1).getByText('OK済み').count()) === 1);
check('提案者Aには「ほかの回答者のOK待ち (1/3)」が出る', (await item(ra, q1).getByText('ほかの回答者のOK待ち (1/3)').count()) === 1);
await approve(rb, q1);
await rc.waitForTimeout(400);
check('2人OKでもまだ届かない (2/3)', (await gm.locator('.reply-button').count()) === 0 && (await item(rc, q1).getByText(/2\/3/).count()) === 1);
await approve(rc, q1);
await gm.locator('li', { hasText: q1 }).filter({ has: gm.locator('.reply-button') }).first().waitFor({ timeout: 5000 });
check('3人目のOKでその場でGMの列に届く', true);
await approveAll(rb, q2);
await approveAll(rc, g1);
await gm.locator('li', { hasText: g1 }).filter({ has: gm.locator('.reply-button') }).first().waitFor({ timeout: 5000 });
await gm.waitForTimeout(500);
await shotAll('04-gm-queue', all);
check('承認された3件がGMの列に並ぶ', (await gm.locator('li').filter({ has: gm.locator('.reply-button') }).count()) === 3);

// ---- GMの回答: Yes / 嘘のYes / 不正解 ----
await gmReply(gm, q1, 'Yes');
await gmReply(gm, q2, 'Yes', true);
await shotAll('05-after-lie', [gm, ra]);
check('嘘の印は回答者への通信に含まれない', !resp.some((p) => p.frames_.some((f) => f.includes('"lie":true'))));
check('GMの画面には嘘の残りが出る', (await text(gm)).includes('残りの嘘: 0'));
await gmReply(gm, g1, '不正解');
check('3回使い切ると最終解答の段階になる (回答者の画面)', await until(ra.getByText(/最終解答/).first().waitFor({ timeout: 5000 })));
await rd.waitForTimeout(600);
await shotAll('06-final', all);

// ---- GMの訂正: 嘘の付け外し ----
check('回答者の画面に「訂正」ボタンは出ない', (await rd.getByRole('button', { name: '訂正', exact: true }).count()) === 0);
await gmCorrect(q2, 'No', false);
check('嘘のYesをNoに訂正すると、嘘の残りが 1 に戻る', await until(gm.getByText('残りの嘘: 1').first().waitFor({ timeout: 5000 })));
check('全員のログに「訂正: Yes → No」が出る', (await Promise.all(resp.map((p) => until(logItem(p, q2).getByText('訂正: Yes → No').first().waitFor({ timeout: 5000 }))))).every(Boolean));
check('GM以外に訂正の通知が出る', (await Promise.all(resp.map((p) => until(p.getByText(/GMが\d+番の判定を訂正しました/).first().waitFor({ timeout: 5000 }))))).every(Boolean));
await shotAll('06b-corrected', [gm, rc]);
await gmCorrect(q1, 'どちらかといえばYes', true);
check('別の質問を嘘に訂正すると、嘘の残りが 0 になる', await until(gm.getByText('残りの嘘: 0').first().waitFor({ timeout: 5000 })));
// 判定は同じで嘘だけを付け外しする訂正は、回答者の画面に表示も通知も出ない
await gmCorrect(q1, 'どちらかといえばYes', false);
check('嘘だけを外す訂正で、嘘の残りが 1 に戻る', await until(gm.getByText('残りの嘘: 1').first().waitFor({ timeout: 5000 })));
await gmCorrect(q1, 'どちらかといえばYes', true);
check('嘘だけを付け直す訂正で、嘘の残りが 0 に戻る', await until(gm.getByText('残りの嘘: 0').first().waitFor({ timeout: 5000 })));
await rb.waitForTimeout(500);
check('判定が変わらない訂正は、回答者に「X → X」の表示を出さず、通信にも嘘の印が出ない',
  (await Promise.all(resp.map(async (p) => (await logItem(p, q1).getByText(/訂正: どちらかといえばYes → どちらかといえばYes/).count()) === 0))).every(Boolean) &&
  !resp.some((p) => p.frames_.some((f) => f.includes('"lie":true'))));
check('嘘の付け外しを訂正しても、嘘の印は回答者への通信に含まれない', !resp.some((p) => p.frames_.some((f) => f.includes('"lie":true'))));
check('訂正しても残り回数は変わらない (最終解答の段階のまま)', await until(ra.getByText(/最終解答/).first().waitFor({ timeout: 3000 })));

// ---- 延長の依頼と延長 ----
await rd.getByRole('button', { name: '延長をお願い' }).click();
check('延長の依頼がGMの画面に出る', await until(gm.getByText('D さんが延長をお願いしています').waitFor({ timeout: 5000 })));
await shotAll('07-extend-request', [gm, rd]);
await gm.getByRole('button', { name: '延長 +1' }).click();
check('延長すると質問の段階に戻り「残り 1 / 4」になる', (await Promise.all(resp.map((p) => remainingIs(p, 1, 4)))).every(Boolean));

// ---- 却下は回数を使わない ----
const qRej = `ふざけた質問 ${TAG}`;
await propose(rd, 'question', qRej);
await approveAll(rd, qRej);
await gmReply(gm, qRej, '却下');
check('却下しても残り回数は減らない', (await Promise.all(resp.map((p) => remainingIs(p, 1, 4)))).every(Boolean));

// ---- おしい → 最終解答で正解 ----
const g2 = `鳥 ${TAG}`;
await propose(ra, 'guess', g2);
await approveAll(ra, g2);
await gmReply(gm, g2, 'おしい');
check('おしいが全員に見える', (await Promise.all(resp.map((p) => until(item(p, g2).getByText('おしい').first().waitFor({ timeout: 5000 }))))).every(Boolean));
await gmCorrect(g2, '不正解');
check('解答も訂正でき、全員のログに「訂正: おしい → 不正解」が出る', (await Promise.all(resp.map((p) => until(logItem(p, g2).getByText('訂正: おしい → 不正解').first().waitFor({ timeout: 5000 }))))).every(Boolean));
await ra.getByText(/最終解答/).first().waitFor({ timeout: 5000 }).catch(() => {});
await propose(rb, null, ANSWER);
await approveAll(rb, ANSWER);
await gm.locator('li', { hasText: ANSWER }).filter({ has: gm.locator('.reply-button') }).first().waitFor({ timeout: 5000 });
check('正解の判定前は、回答者への通信に答え (answer) が含まれない', !resp.some((p) => p.frames_.some((f) => f.includes(`"answer":"${ANSWER}"`))));
// 確認でキャンセルすると何も送られない
gm.dismissNext_ = true;
gm.dialogs_.length = 0;
await gm.locator('li', { hasText: ANSWER }).filter({ has: gm.locator('.reply-button') }).getByRole('button', { name: '正解', exact: true }).click();
await gm.waitForTimeout(600);
check('ラウンドを終える判定は確認が出て、キャンセルなら送られない',
  gm.dialogs_.length === 1 && gm.dialogs_[0].includes('ラウンドが終わります') && (await gm.locator('.reply-button').count()) > 0 && (await gm.locator('.doors-result').count()) === 0, gm.dialogs_[0] ?? '');
await gmReply(gm, ANSWER, '正解');

// ---- 結果 ----
const revealedAll = await Promise.all(all.map((p) => until(p.locator('.doors-result .answer-reveal .secret-card', { hasText: ANSWER }).waitFor({ timeout: 8000 }))));
check('全員の結果画面に答えが出る', revealedAll.every(Boolean), all.filter((_, i) => !revealedAll[i]).map((p) => p.name_).join(','));
await gm.waitForTimeout(2000);
await shotAll('08-result', all);
check('結果画面のログに訂正が出る', (await Promise.all(resp.map(async (p) => (await p.locator('.result-log', { hasText: '訂正: Yes → No' }).count()) === 1))).every(Boolean));
check('結果画面で嘘が全員に公開される', (await Promise.all(resp.map(async (p) => (await p.locator('.lie-reveal .lie-item', { hasText: q1 }).count()) === 1))).every(Boolean));
check('結果画面で横あふれしない', (await overflowed(all)).length === 0, (await overflowed(all)).join(','));
const errs = all.flatMap((p) => p.errors_.map((e) => `${p.name_}: ${e}`));
check('どのクライアントでもページのエラーが出ない', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
