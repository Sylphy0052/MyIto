// #85 の画面確認: ゲーム中のお題が3行に省略され、タップで全文と3行を切り替えられるか (390x844)
// 使い方: node topic-clamp-check.mjs <base URL> <screenshot dir>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:47302';
const out = process.argv[3] ?? './shots-topic';
mkdirSync(out, { recursive: true });

const LONG = 'あ'.repeat(10) + 'い'.repeat(10) + 'う'.repeat(10) + 'え'.repeat(10) + 'お'.repeat(10) +
  'か'.repeat(10) + 'き'.repeat(10) + 'く'.repeat(10) + 'け'.repeat(10) + 'こ'.repeat(10);
const SHORT = 'ねこのなまえ十字';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const results = [];
const check = (name, ok) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
};

async function newClient(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.name_ = name;
  page.on('dialog', (d) => void d.accept());
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
// 行数 = 高さ / 行の高さ
const metrics = (page) =>
  page.locator('.topic-text').evaluate((el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.5;
    return {
      lines: Math.round(el.getBoundingClientRect().height / lh),
      isButton: el.getAttribute('role') === 'button',
      expanded: el.getAttribute('aria-expanded'),
      clamped: el.classList.contains('clamped'),
    };
  });
const settle = (page) => page.waitForTimeout(600);

async function openRoom(topic, mode) {
  const host = await newClient('ホスト');
  const guest = await newClient('ゲスト');
  await enter(host);
  await host.locator('.code').waitFor();
  const code = ((await host.locator('.code').textContent()) ?? '').trim();
  await enter(guest, code);
  await guest.getByText('ホストが開始するのを待っています').waitFor();
  if (mode === 'doors') {
    await host.getByRole('radio', { name: '10の扉' }).click();
    const gm = host.locator('.field-row', { hasText: 'GMの決め方' });
    await gm.locator('select').first().selectOption('named');
    await gm.locator('select').nth(1).selectOption({ label: 'ホスト' });
  }
  await host.locator('input[placeholder$="を自由入力"]').fill(topic);
  await host.getByRole('button', { name: '決定', exact: true }).click();
  await host.waitForFunction((t) => document.querySelector('.topic-text')?.textContent === t, topic);
  await settle(host);
  return { host, guest };
}

// ito・100字
{
  const { host, guest } = await openRoom(LONG, 'ito');
  const lobby = await metrics(host);
  check('ito ロビー: 100字を省略せず全文を出す (9行以上)', !lobby.clamped && !lobby.isButton && lobby.lines >= 8);
  await host.screenshot({ path: `${out}/01-ito-long-lobby.png` });

  await host.getByRole('button', { name: /^配って開始/ }).click();
  await host.locator('.card').first().waitFor({ timeout: 5000 });
  await settle(host);
  const playing = await metrics(host);
  check('ito ゲーム中: 100字が3行に省略される', playing.clamped && playing.lines === 3);
  check('ito ゲーム中: タップできる (role=button, aria-expanded=false)', playing.isButton && playing.expanded === 'false');
  await host.screenshot({ path: `${out}/02-ito-long-clamped.png` });
  await settle(guest);
  check('ito ゲスト側も3行に省略される', (await metrics(guest)).lines === 3);

  await host.locator('.topic-text').click();
  await settle(host);
  const open = await metrics(host);
  check('ito タップで全文が出る (aria-expanded=true、9行以上)', open.expanded === 'true' && open.lines >= 8);
  await host.screenshot({ path: `${out}/03-ito-long-expanded.png` });

  // 全文表示中に幅を変えても (1280幅では3行に収まる)、表示が残り、3行へ戻せる
  await host.setViewportSize({ width: 1280, height: 800 });
  await settle(host);
  await host.setViewportSize({ width: 390, height: 844 });
  await settle(host);
  check('ito 全文表示中に幅を変えて戻しても全文のまま', (await metrics(host)).expanded === 'true');

  await host.locator('.topic-text').click();
  await settle(host);
  const closed = await metrics(host);
  check('ito もう一度タップで3行へ戻る', closed.expanded === 'false' && closed.lines === 3);

  await host.locator('.topic-text').focus();
  await host.keyboard.press('Enter');
  await settle(host);
  check('ito Enterキーで全文が出る', (await metrics(host)).expanded === 'true');
  await host.keyboard.press('Space');
  await settle(host);
  check('ito Spaceキーで3行へ戻る', (await metrics(host)).expanded === 'false');
  await host.context().close();
  await guest.context().close();
}

// ito・10字: 省略せず、タップもできない
{
  const { host, guest } = await openRoom(SHORT, 'ito');
  await host.getByRole('button', { name: /^配って開始/ }).click();
  await host.locator('.card').first().waitFor({ timeout: 5000 });
  await settle(host);
  const m = await metrics(host);
  check('ito 10字: 1行で、タップできる印が付かない', m.lines === 1 && !m.isButton);
  await host.screenshot({ path: `${out}/04-ito-short.png` });
  await host.context().close();
  await guest.context().close();
}

// 10の扉・100字のテーマ。ロビーへ戻ると、同じテーマでも3行へ戻る
{
  const { host, guest } = await openRoom(LONG, 'doors');
  const lobby = await metrics(host);
  check('10の扉 ロビー: 100字を省略せず全文を出す', !lobby.clamped && lobby.lines >= 8);
  await host.getByRole('button', { name: /^開始/ }).click();
  await host.locator('input[placeholder^="答え"]').waitFor({ timeout: 5000 });
  await settle(host);
  const setup = await metrics(host);
  check('10の扉 ゲーム中: 100字が3行に省略され、タップできる', setup.clamped && setup.lines === 3 && setup.isButton);
  await host.screenshot({ path: `${out}/05-doors-long-clamped.png` });

  await host.locator('.topic-text').click();
  await settle(host);
  check('10の扉 タップで全文が出る', (await metrics(host)).lines >= 8);
  await host.screenshot({ path: `${out}/06-doors-long-expanded.png` });

  await host.locator('input[placeholder^="答え"]').fill('ペンギン');
  await host.getByRole('button', { name: '確定' }).click();
  await host.getByText(/残り\s*10\s*\/\s*10/).first().waitFor({ timeout: 5000 });
  await settle(host);
  check('10の扉 段階が進んでも全文表示を保つ', (await metrics(host)).expanded === 'true');

  await host.getByRole('button', { name: /中止して答えを公開/ }).click();
  await host.getByRole('button', { name: /ロビーに戻る/ }).click();
  await host.getByRole('button', { name: /^開始/ }).waitFor({ timeout: 5000 });
  await settle(host);
  const back = await metrics(host);
  check('10の扉 ロビーへ戻ると省略しない (全文)', !back.clamped && back.lines >= 8);
  await host.getByRole('button', { name: /^開始/ }).click();
  await host.locator('input[placeholder^="答え"]').waitFor({ timeout: 5000 });
  await settle(host);
  const again = await metrics(host);
  check('10の扉 次のゲームは同じテーマでも3行から始まる', again.clamped && again.lines === 3 && again.expanded === 'false');
  await host.context().close();
  await guest.context().close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
