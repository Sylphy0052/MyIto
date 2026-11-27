---
name: e2e-ai-mode-env
description: .envが無いかASK_*が入っていないと、検証サーバーでAIモードが出ない。.envに書くかプロセスの環境変数で渡す
updated: 2026-11-27
---

# 検証サーバーでAIモードが使えない

## 何が起きたか

- 手元で`npm start`した検証サーバーに、10の扉の「AIがGM」が出なかった
- 起動ログに `ASK API is not configured: ASK_API_KEY is empty, ASK_PROJECT_ID must be a positive integer` が出ていた (`aiAvailable = isAskConfigured()`がfalse)

## なぜ

- `npm start` (`tsx server/index.ts`) はrepoのルートの`.env` (`server/loadEnv.ts`) を読む。`.env`が無いか、`ASK_*`が入っていないと未設定になる

## どうするか

- AIモードを試すときは、`ASK_API_KEY`と`ASK_PROJECT_ID`を`.env`に書くか、プロセスの環境変数で渡して起動する (プロセスの環境変数が優先) (値は共有しない・書き残さない)
- AIを使わず画面だけ確かめるなら、`scripts/e2e/mock-ask.mjs`のモックを使う。`ASK_API_URL=http://localhost:47301`で向け、`ASK_API_KEY`と`ASK_PROJECT_ID`はダミー値 (例: `dummy`と`1`) でよい
- モデルの既定値と`DOORS_MODEL`は[10の扉のAI GMのモデル](doors-model-variant.md)を見る
