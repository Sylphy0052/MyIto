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
| `doors-check.mjs <URL> <出力dir> [reduced]` | 10の扉を3クライアントで通す。答えの漏えい・承認・残り回数・結果画面。`reduced`でreduced-motion |
| `entry-shot.mjs <URL> <出力dir>` | ログイン画面のタイトルを320/360/390/1280px幅で撮る |
| `mock-ask.mjs [ポート]` | ASK APIの簡易モック (お題を1.5秒後に返す)。`ASK_API_URL=http://localhost:47301`で向けて使う (httpはlocalhostだけ許可される)。このとき`ASK_API_KEY`と`ASK_PROJECT_ID`はダミー値 (例: `dummy`と`1`) でよい |

## 注意

- `npm start`は環境変数のファイルを読まない (読むのはdocker composeだけ)。AIモードを試すには`ASK_API_KEY`と`ASK_PROJECT_ID`をプロセスの環境変数で渡す
- 撮影したスクリーンショットはrepoに置かない
