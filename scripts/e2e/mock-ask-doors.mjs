// ASK API の簡易モック (10の扉のAI GM用)。テンプレートの中身で、答えの決定・質問への回答・解答の判定を見分けて返す
// 答えは「ペンギン」固定。質問に「失敗」を含むと、その質問の1回目だけ HTTP 500 を返す (2回目からは普通に答える。再試行の確認用)
// 使い方: node mock-ask-doors.mjs [ポート]  ASK_API_URL=http://localhost:<ポート> で向ける (ダミーのキーとプロジェクトでよい)
import http from 'node:http';

const port = Number(process.argv[2] ?? 47301);
const failedOnce = new Set();

function reply(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  res.write(JSON.stringify({ type: 'add_message_token', token: JSON.stringify(obj) }) + '\n');
  res.end();
}

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        /* 空のまま扱う */
      }
      const template = String(body.template ?? '');
      let input = {};
      try {
        input = JSON.parse(String(body.userInput ?? '{}'));
      } catch {
        /* 空のまま扱う */
      }
      setTimeout(() => {
        if (template.includes('"answer": "答え"')) {
          return reply(res, { answer: 'ペンギン', memo: '南半球の海辺にすむ飛べない鳥。魚を食べる' });
        }
        if (template.includes('"rating"')) {
          const q = String(input.question ?? '');
          if (q.includes('失敗') && !failedOnce.has(q)) {
            failedOnce.add(q);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            return res.end('mock failure');
          }
          // 立ち絵の確認用に、キーワードで回答の種類を変える
          const rating = q.includes('わからない')
            ? 'unknown'
            : q.includes('たぶん鳥')
              ? 'maybe-yes'
              : q.includes('たぶん違う')
                ? 'maybe-no'
                : q.includes('鳥')
                  ? 'yes'
                  : 'no';
          return reply(res, { meaning: q, rating });
        }
        if (template.includes('"verdict"')) {
          const g = String(input.guess ?? '');
          const verdict = g.includes('ペンギン') ? 'correct' : g === '鳥' ? 'close' : 'wrong';
          return reply(res, { verdict, reason: 'モックの判定' });
        }
        // 上のどれでもなければ、お題の候補として返す (ロビーのお題生成)
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write(JSON.stringify({ type: 'add_message_token', token: '朝の眠気の強さ\n' }) + '\n');
        res.end();
      }, 600);
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`mock ask (doors) on :${port}`));
