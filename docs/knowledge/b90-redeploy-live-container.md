---
name: b90-redeploy-live-container
description: b90で公開中の10の扉 (myito-live-app) は、~/MyIto-liveでビルドし、compose runで単発起動している。入れ替え手順と、起動が一度失敗することがある点
updated: 2026-11-20
---

# b90の公開コンテナ (myito-live-app) を入れ替える

## 何が起きたか

- 公開中のコンテナ`myito-live-app` (ポート47214) は、`docker compose up`ではなく、`~/MyIto-live`で`docker compose -p myito-live run -d --name myito-live-app -p 47214:47213 --no-deps ito`と起動された単発のコンテナだった。コンテナのラベルが`oneoff=True`で、再起動ポリシーも無い
- compose.yamlのポートは`47213:47213`なので、compose.yamlだけを見ると47214にならない。ポート47213の`myito-ito-1`は別の古い起動で、触らない
- 旧コンテナを`docker rm -f`したあとの1回目の起動が、WSL側の`UtilAcceptVsock:273: accept4 failed 110`で終了コード1になった。コンテナはできておらず、同じコマンドを再実行して通った

## なぜ

- 起動方法はコンテナのラベル (`com.docker.compose.project`・`working_dir`・`oneoff`) から分かる。compose.yamlには書かれていない
- accept4のエラーは、WSLからb90へのsshの接続が不安定なために、手元の側で出たとみている (未確認)。`docker rm -f`と起動の間にあるので、失敗すると公開が止まる

## どうするか

1. 先にビルドする。旧コンテナは動かしたまま、`~/MyIto-live`で`git fetch origin --prune`、`git switch -c live-mainN origin/main`、`docker compose -p myito-live build`を順に実行する (未追跡の`live-*.mts`は残る)
2. ビルドが通ってから、`docker rm -f myito-live-app`と上の`compose run`を続けて実行する。止まる時間を短くするため、2つの間に別の作業を挟まない
3. `compose run`が失敗したら、`docker ps -a --filter name=myito-live`でコンテナの有無を確かめてから、同じコマンドを再実行する
4. `docker ps`でUp、`curl http://localhost:47214/`で200、`docker exec myito-live-app grep -c <新機能の名前> server/game.ts`で新しい版であることを確かめる
5. 進行中のルームはメモリ上にあり、入れ替えで切れる。入れ替える前に、使っている人がいないかユーザーに確かめる
- ssh越しの書き方は [b90-powershell-ssh-quoting](b90-powershell-ssh-quoting.md) を見る
