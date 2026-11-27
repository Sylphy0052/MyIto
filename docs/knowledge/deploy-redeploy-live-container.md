---
name: deploy-redeploy-live-container
description: デプロイ先サーバで公開中の10の扉は、公開用の作業dirでビルドし、compose runで単発起動している。入れ替え手順と、起動が一度失敗することがある点
updated: 2026-11-27
---

# デプロイ先サーバの公開コンテナを入れ替える

## 何が起きたか

- 公開中のコンテナ`<公開用コンテナ>` (ポート47214) は、`docker compose up`ではなく、`<公開用の作業dir>`で`docker compose -p <公開用プロジェクト> run -d --name <公開用コンテナ> -p 47214:47213 --no-deps ito`と起動された単発のコンテナだった。コンテナのラベルが`oneoff=True`で、再起動ポリシーも無い
- compose.yamlのポートは`47213:47213`なので、compose.yamlだけを見ると47214にならない。ポート47213の`<作業dir名>-ito-1` (composeで起動した古いコンテナ) は、触らない
- 旧コンテナを`docker rm -f`したあとの1回目の起動が、WSL側の`UtilAcceptVsock:273: accept4 failed 110`で終了コード1になった。コンテナはできておらず、同じコマンドを再実行して通った

## なぜ

- 起動方法はコンテナのラベル (`com.docker.compose.project`・`working_dir`・`oneoff`) から分かる。compose.yamlには書かれていない
- accept4のエラーはWSL側で出たもので、原因は未確認。同じコマンドの再実行で通った

## どうするか

1. 先にビルドする。旧コンテナは動かしたまま、`<公開用の作業dir>`で`git fetch origin --prune`、`git switch -c live-main<次の番号> origin/main` (ブランチ名は`git branch`で既存の最大番号を見て決める)、`docker compose -p <公開用プロジェクト> build`を順に実行する (未追跡の`live-*.mts`は残る)
2. ビルドが通ってから、`docker rm -f <公開用コンテナ>`と上の`compose run`を続けて実行する。`rm`のあと`run`が失敗すると公開が止まるので、2つの間に別の作業を挟まない
3. `compose run`が失敗したら、`docker ps -a --filter name=<公開用コンテナ>`でコンテナの有無を確かめてから、同じコマンドを再実行する
4. `docker ps`でUp、`curl http://localhost:47214/`で200、`docker exec <公開用コンテナ> grep -c <新機能の名前> server/game.ts`で新しい版であることを確かめる
5. 進行中のルームはメモリ上にあり、入れ替えで切れる。入れ替える前に、使っている人がいないかユーザーに確かめる

ssh越しの書き方は [deploy-ssh-via-powershell](deploy-ssh-via-powershell.md) を見る
