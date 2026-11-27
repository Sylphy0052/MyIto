---
name: deploy-ssh-via-powershell
description: WSLからデプロイ先サーバへのsshは届かない。Windows側のsshをpowershell.exe経由で使い、複数コマンドは1つずつ分ける
updated: 2026-11-27
---

# WSLからデプロイ先サーバへのsshは、powershell.exe経由で使う

## 何が起きたか

- WSLで`ssh <deploy-host> '...'`を実行すると、応答が無いまま止まる (2026-10-30に再現。30秒待っても出力なし)。それより前の試行では`ssh: connect to host <deploy-host> port 22: Connection timed out`が出た
- Windows側のOpenSSHで`powershell.exe -NoProfile -Command "ssh <deploy-host> '...'"`とすると、つながる
- Windows側の`scp`に`\\wsl.localhost\...`のパスを渡すと、`stat local ...: Unknown error`で失敗する
- `powershell.exe -NoProfile -Command "ssh <deploy-host> 'docker ps ...; cd ~/dir && git log ...'"`が、`トークン '&&' は、このバージョンでは有効なステートメント区切りではありません`と文字列終端のParserErrorで失敗した (WindowsのPowerShell 5.1)
- `docker ps --format "{{.Names}} ..."`のように二重引用符を入れ子にすると、docker側に引数が分割されて渡り、`"docker ps" accepts no arguments`になった
- `docker inspect --format`のtemplateに二重引用符を使うと、`template parsing error: unclosed action`になった

## なぜ

- WSL2のネットワークからデプロイ先サーバへ経路が無いためと推測している (未確認)。Windows側からは届く
- 外側の`-Command "..."`はPowerShellが先に解釈する。`&&`はPowerShell 5.1の区切りではなく、入れ子の引用符も外側で崩れる。`'...'`の内側の`;`は、リモートのシェルへ届いて通った (`cd <公開用の作業dir>; git log --oneline | head -3; ls -a`で確認)

## どうするか

- デプロイ先での操作は`powershell.exe -NoProfile -Command "ssh <deploy-host> '<command>'"`で行う
- リモートのコマンドは`'`の内側に置き、区切りは`;`にする。`&&`と二重引用符は使わない。失敗したら、コマンドを1つずつ別の呼び出しに分ける
- `docker inspect --format`のtemplateは引用符で囲まず、空白を含まない形で渡す (例: `--format {{.HostConfig.RestartPolicy.Name}}_{{.Config.Cmd}}`)
- ファイルを送るときは`scp`を使わず、WSLでbase64にしたものを標準入力で渡す

  ```sh
  base64 -w0 <file> > <file>.b64
  powershell.exe -NoProfile -Command "ssh <deploy-host> 'base64 -d > ~/<dest>'" < <file>.b64
  ```

- コンテナの環境変数を取り出す操作がhookに拒否されたときの扱いは、[deploy-trial-run-with-env](deploy-trial-run-with-env.md)を見る
