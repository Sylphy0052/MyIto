---
name: e2e-ai-mode-env
description: npm startは環境変数のファイルを読まないので、検証サーバーでAIモードが出ない。ASK_*をプロセスに渡す
updated: 2026-11-20
---

# 検証サーバーでAIモードが使えない

## 何が起きたか

- 手元で`npm start`した検証サーバーに、10の扉の「AIがGM」が出なかった
- 起動ログに `ASK API is not configured: ASK_API_KEY is empty, ASK_PROJECT_ID must be a positive integer` が出ていた (`aiAvailable = isAskConfigured()`がfalse)

## なぜ

- `npm start` (`tsx server/index.ts`) は環境変数のファイルを読まない。読むのはdocker composeだけ

## どうするか

- AIモードを試すときは、`ASK_API_KEY`と`ASK_PROJECT_ID`をプロセスの環境変数で渡して起動する (値は共有しない・書き残さない)
- AIを使わず画面だけ確かめるなら、`scripts/e2e/mock-ask.mjs`のモックを使う。`ASK_API_URL=http://localhost:47301`で向け、`ASK_API_KEY`と`ASK_PROJECT_ID`はダミー値 (例: `dummy`と`1`) でよい
- 既定モデルは`gpt-6-luna-thinking` (`DOORS_MODEL`で変更)。`gpt-6.1-luna`系は400になる ([ASK APIのmodelVariant](ask-model-variant.md))
