# e2e (画面確認スクリプト)

Playwright-coreで複数クライアントを開き、画面と通信を確かめる手動用のスクリプト。CIには載せていない。

## 準備

```
cd scripts/e2e
npm install
```

Chromeは`/usr/bin/google-chrome`を使う (`--no-sandbox`)。別の場所なら各スクリプトの`executablePath`を直す。

## 使い方

アプリを`PORT=<ポート> npm start`で起動してから、そのURLを渡す。

| スクリプト | 内容 |
|---|---|
| `lobby-check.mjs <URL> <出力dir>` | お題候補の表示・生成中表示・選択の反映 (ホストとゲスト) |
| `doors-check.mjs <URL> <出力dir> [reduced]` | 10の扉を3クライアントで通す。GMランダムの次のGM表示と引き直し、答えの漏えい・承認・残り回数・結果画面。`reduced`でreduced-motion |
| `ai-gm-check.mjs <URL> <出力dir>` | AI GMを1クライアントで通す (19項目)。答えの非公開、質問への回答、失敗の通知・失敗ラベル・順番待ち・取り消し・再試行、解答3種、結果画面、スマホ幅の横あふれ。サーバは`mock-ask-doors.mjs`に向けて起動する |
| `mock-ask-doors.mjs [ポート]` | 10の扉用のASKモック。答えは「ペンギン」固定。質問に「失敗」を含むと、その質問の1回目だけ HTTP 500。解答は「ペンギン」を含むと正解、「鳥」だけだとおしい、それ以外は不正解。答えがテーマに合うかは見られない |
| `ai-live-ui.mjs <URL> <出力dir> [テーマ ...]` | 本物のASKで、テーマごとにAI GMが決めた答えを画面から読んで一覧にする (テーマ省略時は内蔵の8件と指定なし2件)。合っているかは人が出力と画像で判断する。サーバは本物のキーで起動する |
| `entry-shot.mjs <URL> <出力dir>` | ログイン画面のタイトルを320/360/390/1280px幅で撮る |
| `mock-ask.mjs [ポート]` | ASK APIの簡易モック (お題を1.5秒後に返す)。`ASK_API_URL=http://localhost:47301`で向けて使う (httpはlocalhostだけ許可される)。このとき`ASK_API_KEY`と`ASK_PROJECT_ID`はダミー値 (例: `dummy`と`1`) でよい |

## 注意

- `npm start`は環境変数のファイルを読まない (読むのはdocker composeだけ)。AIモードを試すには`ASK_API_KEY`と`ASK_PROJECT_ID`をプロセスの環境変数で渡す
- 撮影したスクリーンショットはrepoに置かない
