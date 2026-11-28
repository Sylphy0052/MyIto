import { chromium } from 'playwright-core';

// Chromeの場所は環境変数CHROME_PATHで上書きできる
export const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/google-chrome';

export function launchChrome() {
  return chromium.launch({ executablePath: CHROME_PATH, args: ['--no-sandbox'] });
}
