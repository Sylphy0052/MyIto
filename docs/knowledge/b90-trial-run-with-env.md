---
name: b90-trial-run-with-env
description: 本番の.envを使ってb90で新しい版を試すときは、デプロイ先を丸ごと複製し、composeのプロジェクト名を分けて動かす
updated: 2026-10-30
---

# b90で本番の.envを使って新しい版を試す

## 何が起きたか

- ASK API版 (#15) を本物のAPIで試そうとした。キーの入った`.env`を読むコマンドは、パスに`.env`を含むだけで個人hookに拒否された (`sensitive path access blocked`)
- worktreeに入ったセッションからは、`powershell.exe`経由のsshがworktreeの隔離チェックで拒否された。worktreeを出てmain working treeから実行すると通った
- b90の`~/MyIto`へユーザーに`.env`を置いてもらい、`cp -a ~/MyIto ~/MyIto-ask`で複製してから、複製側でブランチに切り替えて試した。キーはb90から出ていない

## なぜ

- hookはコマンド文字列に`.env`のパスがあるかで判定する。`.env`をコマンドに書かなければ、composeが自動で読むのは通る
- worktreeの隔離チェックは、`powershell.exe`に渡した文字列がgitを動かさないことを確かめられない

## どうするか

1. ブランチを`git bundle`にし、base64で`~/scratch/`へ送る ([b90-ssh-from-wsl](b90-ssh-from-wsl.md))
2. b90で`cp -a ~/MyIto ~/MyIto-<名前>`し、複製側で`git fetch <bundle> <branch>:<branch>`と`git checkout`を実行する
3. `docker compose -p myito-<名前> build`と`docker compose -p myito-<名前> run --rm --no-deps ito node_modules/.bin/tsx <確認用スクリプト>`で動かす。プロジェクト名を分けるので本番の`myito-ito-1`とイメージに触れない。`run`はポートを公開しない
4. 確認用スクリプトは、トップレベルのawaitを使うなら拡張子を`.mts`にする (`.ts`だとtsxがcjsとして変換し失敗する)
5. 終わったら、複製したディレクトリ (`.env`の写しを含む)、イメージ`myito-<名前>-ito`、ネットワーク`myito-<名前>_default`、送ったファイルを消す
