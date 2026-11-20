// 起動時に、カレントディレクトリの環境変数ファイルがあれば読む (npm start でもASKの設定が効くように)。
// 既にプロセスにある環境変数は上書きしない (docker compose や起動コマンドの指定が優先)。
// 他のモジュールが import 時に process.env を読むので、server/index.ts の最初の import にする
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
