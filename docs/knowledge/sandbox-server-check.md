---
name: sandbox-server-check
description: エージェントのsandbox内でサーバを起動して確かめるとき、worktreeにnode_modulesが無いとtscが別の場所のものを使い、tsx CLIは/tmpのpipeで止まる
updated: 2026-11-28
---

# sandbox内でサーバの型検査と起動確認をする

## 何が起きたか

#106の作業で、作業用worktree (`.agents/worktrees/...`) から次の2つが失敗した。

- `npx tsc --noEmit` が `Cannot find module 'compression'` で落ちた。
- socket.io-clientで進行を確かめるために `tsx server/index.ts` を子プロセスで起動すると、`listen EPERM: operation not permitted /tmp/claude-1000/tsx-1000/11.pipe` で起動しなかった。

## なぜ

- worktreeには `node_modules` が無く、`npx` は親ディレクトリ (main working tree) の古い `node_modules` を使った。そこには後から足した依存が入っていない。
- tsx のCLIは、watch等のために `/tmp` 配下へIPC用のpipeを作る。sandboxは `/tmp` への書き込みを断る。

## どうするか

- worktreeで最初に `npm ci` を単独で実行してから `npx tsc --noEmit` を流す。
- sandbox内でサーバを起動するときは、tsx をCLIではなくloaderとして読む: `node --import tsx server/index.ts`。
- サーバの起動・接続・停止は、1つのNodeスクリプトの中で子プロセスとして行う (sandboxはコマンドごとにネットワークを分けるため、別のBash呼出からは接続できない)。
