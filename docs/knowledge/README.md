# knowledge

作業中の失敗と、そこから分かったことを1ファイル1件で残す。

- [WSLからデプロイ先サーバへのsshは、powershell.exe経由で使う](deploy-ssh-via-powershell.md) — 複数コマンドは1つずつ分け、ファイルはbase64で送る
- [z-index -1の背景演出がbodyの背景に隠れる](negative-z-index-behind-body.md) — 親に`isolation: isolate`を付ける
- [デプロイ先サーバで本番の環境変数ファイルを使って新しい版を試す](deploy-trial-run-with-env.md) — デプロイ先を複製し、composeのプロジェクト名を分けて動かす
- [ASK APIのmodelVariant](ask-model-variant.md) — Sonnet 5.5は`claude-55-sonnet-thinking`で通る
- [10の扉のAI GMのモデル (DOORS_MODEL)](doors-model-variant.md) — `gpt-6-luna-thinking`が既定。`gpt-6.1-luna`系は400になる
- [Issueの前提は実画面で確かめてから起票する](issue-premise-check-existing-ui.md) — #25は既に実装済みの表示を直す前提だった
- [検証サーバーでAIモードが使えない](e2e-ai-mode-env.md) — .envが無いか`ASK_*`が入っていないと、検証サーバーでAIモードが出ない。.envに書くかプロセスの環境変数で渡す
- [計算機サーバでPlaywrightの画面確認を回す](e2e-playwright-docker-on-compute-server.md) — 公式imageを非rootで回すときは`HOME`と`TMPDIR=/tmp`を明示する
- [デプロイ先サーバの公開コンテナを入れ替える](deploy-redeploy-live-container.md) — 公開用の作業dirでビルドしてcompose runで単発起動。1回目の起動が失敗することがある
- [e2eでGMの決め方のselectを掴めずタイムアウトする](e2e-lobby-select-by-row.md) — labelと結びついていない。`.field-row`の見出しで絞って掴む
- [worktree作業中に相対パスでfinalize.pyを流す](finalize-from-main-cwd.md) — cwdがmainのままだと古いスクリプトがmain側へ書く。絶対パスと`--public`を明示する
- [sandbox内でサーバの型検査と起動確認をする](sandbox-server-check.md) — worktreeで先に`npm ci`。tsxは`node --import tsx`で読む
