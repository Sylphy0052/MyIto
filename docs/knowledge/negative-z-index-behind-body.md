---
name: negative-z-index-behind-body
description: z-index -1の背景演出がbodyの背景に隠れる。親に`isolation: isolate`を付ける
updated: 2026-10-30
---

# z-index -1の背景演出がbodyの背景に隠れる

## 何が起きたか

- 背景に漂うカード (`.backdrop`、`position: fixed; z-index: -1`) を足したところ、画面に何も出なかった
- headless Chromeで`getBoundingClientRect()`を取ると、位置・不透明度・`animation-name`は想定どおりだった。色を濃くしても見えなかった

## なぜ

`:root`と`body`の両方に`background`がある。`:root`に背景があると`body`の背景はcanvasへ伝播せず、`body`のブロック背景として描かれる。ルートの重ね合わせコンテキストでは、負のz-indexの要素は通常フローのブロック背景より先に描かれるので、`body`の背景に塗りつぶされる。

## どうするか

- 背景演出を入れる親 (`.app`) に`isolation: isolate`を付け、その中で`z-index: -1`を使う。`position: fixed`の基準はviewportのまま変わらない
- 見えないときは、色や不透明度をいじる前に描画順を疑う
