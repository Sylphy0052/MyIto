---
name: finalize-from-main-cwd
description: worktreeで作業中に相対パスでfinalize.pyを流すと、main working treeの古いスクリプトと配置先が使われる
updated: 2026-11-27
---

## 何が起きたか

#61でworktree (`.claude/worktrees/feat-gm-expression`) の立ち絵を差し替える途中、シェルのcwdがmain working treeのまま `uv run ... python3 scripts/assets/finalize.py --in <dir> --only portrait` を実行した。main側の `finalize.py` (7表情版) が走り、`smug.webp` が出ないまま、main側の `client/public/gm/` の6枚を書き換えた。

## なぜ

`scripts/assets/finalize.py` も既定の `--public client/public` も、cwdからの相対パスで決まる。Bashのcwdはworktreeへ移っておらず、main側のファイルが使われた。

## どうするか

- worktreeの作業では、スクリプトを絶対パスで呼び、`--public <worktree>/client/public` を明示する。
- 実行後に `git -C <main> status --short` でmain側が汚れていないことを確かめる。汚れていたら、出力をworktreeで作り直してから `git -C <main> restore` で戻す。
