---
name: doors-model-variant
description: 10の扉のAI GMのモデルは、gpt-6-luna-thinkingが既定。gpt-6.1-luna系は400になる
updated: 2026-11-27
---

# 10の扉のAI GMのモデル (DOORS_MODEL)

## 何が起きたか

- 実機のASK APIへ送った結果 (デプロイ先サーバでデプロイ先を複製し、別のcomposeプロジェクトから送った)。`gpt-6.1-luna`・`gpt-61-luna`と、それぞれの`-thinking`付きはすべて400。`gpt-6-luna`と`gpt-6-luna-thinking`は200で答えが返った。応答は約1.7秒

## なぜ

- 質問の意味の読み取りと解答の判定に推論が効き、30秒のタイムアウトに収まるため、`gpt-6-luna-thinking`を既定にした

## どうするか

- `DOORS_MODEL`の既定値は`gpt-6-luna-thinking`。ロビーでホストが2つから選べる (PR #35)。環境変数`DOORS_MODEL`は既定値だけを決め、候補外なら無視される
- お題生成のモデル (`ASK_MODEL`) は別の設定 ([ask-model-variant](ask-model-variant.md))
- 試す手順は[deploy-trial-run-with-env](deploy-trial-run-with-env.md)
