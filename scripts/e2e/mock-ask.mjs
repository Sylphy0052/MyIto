// ASK API の簡易モック。1.5秒待ってから、1行1JSONのストリームでお題を返す
import http from 'node:http';

const port = Number(process.argv[2] ?? 47301);
const topics = ['怖い妖怪の強さ', '朝の眠気の強さ', 'カレーの辛さ', '犬の人懐っこさ', '夏の暑さへの強さ'];

http
  .createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        for (const t of topics) res.write(`${JSON.stringify({ type: 'add_message_token', token: `${t}\n` })}\n`);
        res.end();
      }, 1500);
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`mock ask on :${port}`));
