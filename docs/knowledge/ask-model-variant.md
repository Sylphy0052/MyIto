---
name: ask-model-variant
description: ASK APIのSonnet 5.5はclaude-55-sonnet-thinkingで通る。thinkingの付かない版は使わない
updated: 2026-10-30
---

# ASK APIのmodelVariant

## 何が起きたか

- Sonnet 5.5の`modelVariant`の値は、参照したNoteDockの定義に無かった。命名規則 (`claude-45-sonnet-thinking`、`claude-46-sonnet-thinking`、`claude-5-sonnet-thinking`) から`claude-55-sonnet-thinking`と推測した
- 2026-10-30にb90から本物のASK APIへ送り、お題が返った (`TOPIC 怖い妖怪の強さ 1728ms`)

### GPT-6.1-Luna (10の扉のAI GM)

- 実機のASK APIへ送った結果 (b90でデプロイ先を複製し、別のcomposeプロジェクトから送った)。`gpt-6.1-luna`・`gpt-61-luna`と、それぞれの`-thinking`付きはすべて400。`gpt-6-luna`と`gpt-6-luna-thinking`は200で答えが返った。応答は約1.7秒
- `DOORS_MODEL`の既定値は`gpt-6-luna-thinking`。質問の意味の読み取りと解答の判定に推論が効き、30秒のタイムアウトに収まるため。ロビーでホストが2つから選べる (PR #35)。環境変数`DOORS_MODEL`は既定値だけを決め、候補外なら無視される

## なぜ

- NoteDock側の記録では、ASKは使えない値に400を返し、Sonnet系のthinkingが付かない版はストリームの途中でプロンプトキャッシュのエラーになる。400にならず本文が返ったので、この値は受け付けられている

## どうするか

- 既定値は`server/ai.ts`の`ASK_MODEL`。変えるときはコードを直さず、`.env`の`ASK_MODEL`で上書きする
- 新しい値を試すときは、Sonnet系はthinking版を選ぶ。手順は[b90-trial-run-with-env](b90-trial-run-with-env.md)
- 値が通らないとAI生成は内蔵リストのお題になり、ログに`AI topic failed: ASK API returned 400: ...`が出る
