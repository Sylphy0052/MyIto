---
name: e2e-playwright-docker-on-compute-server
description: 計算機サーバにはnode 20以上もChromeも無い。Playwright公式imageを非rootで回すときは、HOMEとTMPDIRを明示する
updated: 2026-11-20
---

# 計算機サーバでPlaywrightの画面確認を回す

## 何が起きたか

- ある計算機サーバのnodeは`v6.13.1` (Anaconda)で、MyItoの要求 (`>=20.12`) を満たさない。Chromeも無い。dockerはある
- `mcr.microsoft.com/playwright:v1.65.1-noble` (playwright-coreのバージョンに合わせる) をpullして回した。`cs.py run --docker`は非rootでコンテナを動かす
- 1回目: `ln -s ... /usr/bin/google-chrome`が`Permission denied`、`npm ci`が`/.npm`へ書けず失敗した
- 2回目: Chromeが`Socket path too long: <作業dirの長いパス>/tmp/org.chromium.Chromium.XXXX/SingletonSocket`で起動しなかった。計算機サーバの作業dirが`TMPDIR`になっていて、パスが長すぎる

## なぜ

- 非rootなので`/usr/bin`と`/`直下のnpmキャッシュに書けない
- `cs.py`は`TMPDIR`を作業dir (共有ストレージ上の長いパス) へ向ける。ChromeのUnixソケットのパスは108バイト未満でなければならない

## どうするか

- コンテナ内で`export HOME=<作業dirのマウント先>/home`、`export npm_config_cache=$HOME/.npm`、`export TMPDIR=/tmp`にする
- Chromeのパスは`find /ms-playwright -type f -name chrome -path '*chromium-*'`で探し、スクリプトの`/usr/bin/google-chrome`を`sed`で置き換える (symlinkは作れない)
- `--docker-args="-v <作業dir>:/work --shm-size 2g"`で渡す。`--ipc=host`と`--network=host`は拒否される
- pullしたimageは`cleanup`では消えないことがある (`images: []`だった)。`docker rmi`を別のjobで実行して消す
- 手元から見たいときは、`ssh -F ~/.cache/compute-server/ssh_config -o ControlMaster=no -o ControlPath=none -N -L <ポート>:127.0.0.1:<ポート> <IP>`でトンネルを張る。`-p <ポート>:<ポート>`で公開したコンテナへ届く。複数人で使う用途は、計算機サーバの規約 (サービス運用に使わない) に反するので、本物のキーが使える自分のデプロイ先に置く
