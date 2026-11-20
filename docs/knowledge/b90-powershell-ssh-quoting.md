---
name: b90-powershell-ssh-quoting
description: powershell.exe経由のsshは、複数コマンドをつなぐとPowerShellのパースで壊れる。1コマンドずつ分け、docker inspectのformatは波括弧だけで書く
updated: 2026-11-20
---

# powershell.exe経由のsshで複数コマンドが壊れる

## 何が起きたか

- `powershell.exe -NoProfile -Command "ssh b90 'docker ps ...; cd ~/dir && git log ...'"`が、`トークン '&&' は、このバージョンでは有効なステートメント区切りではありません`と文字列終端のParserErrorで失敗した (WindowsのPowerShell 5.1)
- `docker ps --format "{{.Names}} ..."`のように二重引用符を入れ子にすると、docker側に引数が分割されて渡り、`"docker ps" accepts no arguments`になった
- `docker inspect --format`のtemplateに二重引用符を使うと、`template parsing error: unclosed action`になった

## なぜ

- 外側の`-Command "..."`はPowerShellが先に解釈する。`&&`はPowerShell 5.1の区切りではなく、入れ子の引用符も外側で崩れる
- `;`で区切るのは、`'...'`の内側にある限りリモートのシェルへ届くので通る。壊れたのは`&&`と二重引用符の入れ子だった

## どうするか

- リモートのコマンドは`'`の内側に置き、区切りは`;`にする。`&&`と二重引用符は使わない
- 失敗したら、コマンドを1つずつ別の呼び出しに分ける
- `docker inspect --format`のtemplateは引用符で囲まず、空白を含まない形で渡す (例: `--format {{.HostConfig.RestartPolicy.Name}}_{{.Config.Cmd}}`)
- `.env`をコマンドに書くとhookに拒否される ([b90-trial-run-with-env](b90-trial-run-with-env.md))。環境変数の名前を見たいときは、`docker inspect`の出力を取らずに、起動に使ったcompose.yamlを読む
- 接続できない場合は [b90-ssh-from-wsl](b90-ssh-from-wsl.md) を見る
