---
name: ask-model-variant
description: ASK APIのSonnet 5.5はclaude-55-sonnet-thinkingで通る。thinkingの付かない版は使わない
updated: 2026-11-27
---

# ASK APIのmodelVariant

## 何が起きたか

- Sonnet 5.5の`modelVariant`の値は、参照したASK側の定義に無かった。命名規則 (`claude-45-sonnet-thinking`、`claude-46-sonnet-thinking`、`claude-5-sonnet-thinking`) から`claude-55-sonnet-thinking`と推測した
- 2026-10-30にデプロイ先サーバから本物のASK APIへ送り、お題が返った (`TOPIC 怖い妖怪の強さ 1728ms`)

## なぜ

- ASK側の記録では、ASKは使えない値に400を返し、Sonnet系のthinkingが付かない版はストリームの途中でプロンプトキャッシュのエラーになる。400にならず本文が返ったので、この値は受け付けられている

## どうするか

- お題生成のモデルの既定値は`server/ai.ts`の定数`ASK_MODEL`。10の扉のAI GMが使う`DOORS_MODEL`とは別の設定 ([doors-model-variant](doors-model-variant.md))。変えるときはコードを直さず、環境変数の`ASK_MODEL`で上書きする
- 新しい値を試すときは、Sonnet系はthinking版を選ぶ。手順は[deploy-trial-run-with-env](deploy-trial-run-with-env.md)
- 値が通らないとAI生成は内蔵リストのお題になり、ログに`AI topic failed: ASK API returned 400: ...`が出る
