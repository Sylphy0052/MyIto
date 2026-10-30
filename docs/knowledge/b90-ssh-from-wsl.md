---
name: b90-ssh-from-wsl
description: WSLからb90へのsshは届かない。Windows側のsshをpowershell.exe経由で使う
updated: 2026-10-30
---

# WSLからb90へのsshは届かない

## 何が起きたか

- WSLで`ssh b90 '...'`を実行すると、応答が無いまま止まる (2026-10-30に再現。30秒待っても出力なし)。それより前の試行では`ssh: connect to host b90 port 22: Connection timed out`が出た
- Windows側のOpenSSHで`powershell.exe -NoProfile -Command "ssh b90 '...'"`とすると、つながる
- Windows側の`scp`に`\\wsl.localhost\...`のパスを渡すと、`stat local ...: Unknown error`で失敗する

## なぜ

WSL2のネットワークから社内のb90へ経路が無いためと推測している (未確認)。Windows側からは届く。

## どうするか

- b90での操作は`powershell.exe -NoProfile -Command "ssh b90 '<command>'"`で行う
- ファイルを送るときは`scp`を使わず、WSLでbase64にしたものを標準入力で渡す

  ```sh
  base64 -w0 <file> > <file>.b64
  powershell.exe -NoProfile -Command "ssh b90 'base64 -d > ~/<dest>'" < <file>.b64
  ```
