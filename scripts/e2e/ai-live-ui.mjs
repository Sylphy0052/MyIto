// 本物のASKで、AI GMが決める答えがテーマに合っているかを画面から見る
// 各テーマで1人でAI GMのラウンドを始め、テーマ文字列を読み、質問を2つ送って返答を読み、ラウンドを中止して公開された答えを読む
// 使い方: node ai-live-ui.mjs <base URL> <screenshot dir> [テーマ ...]  (テーマ省略時は内蔵の8件と、テーマを指定しない2件)
// サーバは本物の ASK_API_KEY / ASK_PROJECT_ID で起動しておく。答えが合っているかは人が出力と画像で判断する
import { launchChrome } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:47213';
const out = process.argv[3] ?? './shots-ai-live';
mkdirSync(out, { recursive: true });
const given = process.argv.slice(4);
const themes = given.length
  ? given
  : ['好きな食べ物', '苦手な生き物', '行ってみたい国', '好きな教科', '無人島に持っていきたいもの', '好きなスポーツ', '好きな動物', '子どもの頃になりたかった職業', '', ''];
const QUESTIONS = ['それは日本の人の多くが知っていますか?', 'それは身近にありますか?'];

const browser = await launchChrome();
let bad = 0;
for (const [i, theme] of themes.entries()) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on('dialog', (d) => d.accept());
  const tag = `${String(i + 1).padStart(2, '0')}`;
  try {
    await page.goto(base);
    await page.getByLabel('ニックネーム').fill('試験者');
    await page.getByRole('button', { name: 'ルームを作る' }).click();
    await page.locator('.code').waitFor();
    await page.getByRole('radio', { name: '10の扉' }).click();
    await page.locator('select').first().selectOption('ai');
    if (theme) {
      await page.getByPlaceholder('テーマを自由入力').fill(theme);
      await page.getByRole('button', { name: '決定' }).click();
    }
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /^開始/ }).click();
    const t0 = Date.now();
    await page.getByText(/残り\s*10\s*\/\s*10/).first().waitFor({ timeout: 90000 });
    const decided = Date.now() - t0;
    // 開始後のヘッダーに出るテーマ
    const headerTheme = ((await page.locator('body').textContent()) ?? '').match(/テーマ\s*(.+?)AIがGM/)?.[1]?.trim() ?? '';
    const replies = [];
    for (const [n, q] of QUESTIONS.entries()) {
      await page.getByRole('radio', { name: '質問', exact: true }).click();
      await page.locator('.proposal-form input').fill(q);
      await page.getByRole('button', { name: '提案', exact: true }).click();
      const s = Date.now();
      // AIが答えると残り回数が1減る。n問目の後は「残り (10-n-1) / 10」
      const ok = await page.getByText(new RegExp(`残り\\s*${10 - n - 1}\\s*/\\s*10`)).first().waitFor({ timeout: 90000 }).then(() => true, () => false);
      // 残り回数だけでなく、回答バッジが質問の数だけ付いたことも見る
      const answered = ok && (await page.locator('.reply-badge').count()) >= n + 1;
      replies.push(answered ? `${Date.now() - s}ms` : '応答なし(90秒)');
      if (!answered) bad++;
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: `${out}/${tag}-asking.png`, fullPage: true });
    await page.getByRole('button', { name: /中止して答えを公開/ }).click();
    const reveal = await page.locator('.answer-reveal').first().waitFor({ timeout: 10000 }).then(
      async () => ((await page.locator('.answer-reveal').first().textContent()) ?? '').replace(/^答え/, '').trim(),
      () => '(公開された答えが画面に見つからない)',
    );
    await page.screenshot({ path: `${out}/${tag}-reveal.png`, fullPage: true });
    if (reveal.startsWith('(')) bad++;
    // テーマが画面から読めなかったら、画面と指定のずれを見られないので数える
    if (!headerTheme) bad++;
    console.log(`[${tag}] テーマ指定=${theme || '(指定なし)'} 画面のテーマ=${headerTheme} → 答え=${reveal} / 答えが決まるまで ${decided}ms / 質問の応答 ${replies.join(', ')}`);
  } catch (e) {
    bad++;
    console.log(`[${tag}] テーマ指定=${theme || '(指定なし)'} → エラー: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    await page.screenshot({ path: `${out}/${tag}-error.png`, fullPage: true }).catch(() => {});
  }
  await page.context().close();
}
await browser.close();
console.log(`\n${themes.length}件中 ${themes.length - bad}件で答えを読めた。答えがテーマに合っているかは出力と画像で判断する`);
process.exit(bad ? 1 : 0);
