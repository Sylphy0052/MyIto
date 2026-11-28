---
name: deploy-redeploy-live-container
description: デプロイ先サーバで公開中の10の扉を scripts/deploy.sh で入れ替える手順。HOST_PORT、旧コンテナの止め方、版の確認、起動が一度失敗することがある点
updated: 2026-11-28
---

# デプロイ先サーバの公開コンテナを入れ替える

## 何が起きたか

- 以前の公開コンテナ`<公開用コンテナ>` (ポート47214) は、`docker compose up`ではなく`docker compose -p <公開用プロジェクト> run -d --name <公開用コンテナ> -p 47214:47213 --no-deps ito`の単発コンテナだった (ラベル`oneoff=True`、再起動ポリシー無し)。compose.yamlのポートが固定の`47213:47213`で、公開ポートと食い違っていた
- ポート47213の`<作業dir名>-ito-1` (composeで起動した古いコンテナ) は、触らない
- 旧コンテナを`docker rm -f`したあとの1回目の起動が、WSL側の`UtilAcceptVsock:273: accept4 failed 110`で終了コード1になったことがある。原因は未確認。同じコマンドの再実行で通った
- `docker rm -f`はSIGKILLなので、サーバの終了処理 (#93の告知) が走らない。`docker stop -t 10`で止める

## どうするか

1. 遊んでいる人がいないか、ユーザーに確かめる。進行中のルームはメモリ上にあり、入れ替えで切れる (スクリプトは確認しない)
2. `<公開用の作業dir>`で`git fetch origin --prune`、`git switch -c live-main<次の番号> origin/main` (番号は`git branch`で既存の最大番号の次) を実行する
3. `HOST_PORT=47214 COMPOSE_PROJECT_NAME=<公開用プロジェクト> OLD_CONTAINERS=<公開用コンテナ> scripts/deploy.sh --dry-run`で、実行するコマンドを確かめる
4. `--dry-run`を外して実行する。スクリプトは次の順に進む
   - `docker compose build` (失敗したら旧コンテナに触らず止まる)
   - 旧コンテナを`docker stop -t 10`で止めてから削除 (`OLD_CONTAINERS`とcomposeの`ito`)
   - `docker compose up -d ito` (`restart: unless-stopped`が効く)
   - `http://localhost:$HOST_PORT/healthz`が200になるまで最大60秒 (`HEALTH_TIMEOUT`)待つ。だめなら失敗で止まる
   - 起動中のコンテナのラベル`org.opencontainers.image.revision`が、作業dirの`git rev-parse HEAD`と一致するか確かめる (server/のソースは実行用イメージに無いので、`grep server/...`は使えない)
5. 起動が失敗したら、`docker ps -a`でコンテナの有無を確かめてから、同じコマンドを再実行する。旧コンテナは既に消えているので、間を空けない
6. `docker ps`でUp、`curl http://localhost:47214/healthz`で200を確かめる

`HOST_PORT`を渡さなければ47213で起動する。コンテナ内の待受 (47213) は変わらない。

未確認: 旧コンテナと新コンテナの名前・ポートが衝突しない順序で入れ替えられるか (実機で確かめる)。

ssh越しの書き方は [deploy-ssh-via-powershell](deploy-ssh-via-powershell.md) を見る
