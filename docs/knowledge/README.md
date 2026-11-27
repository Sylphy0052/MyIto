# knowledge

作業中の失敗と、そこから分かったことを1ファイル1件で残す。

- [WSLからb90へのsshは届かない](b90-ssh-from-wsl.md) — powershell.exe経由のsshを使い、ファイルはbase64で送る
- [z-index -1の背景演出がbodyの背景に隠れる](negative-z-index-behind-body.md) — 親に`isolation: isolate`を付ける
- [b90で本番の.envを使って新しい版を試す](b90-trial-run-with-env.md) — デプロイ先を複製し、composeのプロジェクト名を分けて動かす
- [ASK APIのmodelVariant](ask-model-variant.md) — Sonnet 5.5は`claude-55-sonnet-thinking`で通る
- [Issueの前提は実画面で確かめてから起票する](issue-premise-check-existing-ui.md) — #25は既に実装済みの表示を直す前提だった
- [検証サーバーでAIモードが使えない](e2e-ai-mode-env.md) — `npm start`は環境変数のファイルを読まない。`ASK_*`を渡す
- [計算機サーバでPlaywrightの画面確認を回す](e2e-playwright-docker-on-compute-server.md) — 公式imageを非rootで回すときは`HOME`と`TMPDIR=/tmp`を明示する
- [powershell.exe経由のsshで複数コマンドが壊れる](b90-powershell-ssh-quoting.md) — `&&`と二重引用符の入れ子を避け、1コマンドずつ分ける
- [b90の公開コンテナを入れ替える](b90-redeploy-live-container.md) — ~/MyIto-liveでビルドしてcompose runで単発起動。1回目の起動が失敗することがある
- [e2eでGMの決め方のselectを掴めずタイムアウトする](e2e-lobby-select-by-row.md) — labelと結びついていない。`.field-row`の見出しで絞って掴む
