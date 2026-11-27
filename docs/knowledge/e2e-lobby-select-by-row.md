---
name: e2e-lobby-select-by-row
description: ロビーのselectはlabelと結びついておらず、ページの1つ目のselectは別の項目に当たる。.field-rowの見出しで絞って掴む
updated: 2026-11-27
---

# e2eでGMの決め方のselectを掴めずタイムアウトする

## 何が起きたか

- #63で`scripts/e2e/doors-check.mjs`に「GMランダム」の確認を足したところ、GMの決め方を`random`にする操作がタイムアウトした
- 当時の書き方は`host.getByLabel('GMの決め方').or(host.locator('select').first()).first()`。GMの決め方とは別のselectを掴み、そちらに無い値を選ぼうとして待ち続けた

## なぜ

- ロビーの設定行は`.field-row`の中に見出しの文字とselectを並べているだけで、`<label for>`で結びついていない。そのため`getByLabel`は何も返さず、`.or`の側のページで1つ目のselectが使われた
- 設定項目が増えると、ページで1つ目のselectが何を指すかが変わる。それまでの`named`指定は、たまたま通っていただけ

## どうするか

- 行の見出しで絞ってから中のselectを取る: `host.locator('.field-row', { hasText: 'GMの決め方' }).locator('select').first()`。同じ行の2つ目 (指名するGM) は`.nth(1)`で取る
- `locator('select').first()`や`.nth(n)`のように、ページ全体の並び順に頼る指定をしない
