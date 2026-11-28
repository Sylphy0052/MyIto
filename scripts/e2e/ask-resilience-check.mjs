// askChat の同時実行上限・再試行・中断を、ローカルのモックASKで確かめる。
// 実行: node --import tsx scripts/e2e/ask-resilience-check.mjs
import http from 'node:http';

const hits = [];
let mode = 'ok';
let active = 0;
let peak = 0;
const t0 = Date.now();
const log = (m) => console.log(`[${String(Date.now() - t0).padStart(5)}ms] ${m}`);

const server = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    hits.push({ at: Date.now(), mode });
    log(`mock ask 受信 #${hits.length} (mode=${mode})`);
    if (mode === '5xx-once' && hits.filter((h) => h.mode === mode).length === 1) {
      res.writeHead(503).end('busy');
      return;
    }
    if (mode === '429-once' && hits.filter((h) => h.mode === mode).length === 1) {
      res.writeHead(429).end('slow down');
      return;
    }
    if (mode === '400') {
      res.writeHead(400).end('bad');
      return;
    }
    active++;
    peak = Math.max(peak, active);
    setTimeout(
      () => {
        active--;
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.end(`${JSON.stringify({ type: 'add_message_token', token: 'ok\n' })}\n`);
      },
      mode === 'slow' ? 800 : 10,
    );
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.ASK_API_URL = `http://127.0.0.1:${server.address().port}`;
process.env.ASK_API_KEY = 'k';
process.env.ASK_PROJECT_ID = '1';
const ai = await import('../../server/ai.ts');
const ask = (signal) => ai.askChat('t', 'u', 'm', signal);
const reset = (m) => {
  hits.length = 0;
  mode = m;
};

console.log(`--- 1. 同時実行の上限 (上限 ${ai.MAX_CONCURRENT_CALLS}, 6件を同時に送る) ---`);
reset('slow');
const rs = await Promise.allSettled(Array.from({ length: 6 }, () => ask()));
rs.forEach((r, i) => log(`#${i} ${r.status}${r.status === 'rejected' ? ` ${r.reason.constructor.name}: ${r.reason.message}` : ''}`));
log(
  `ASK到達 ${hits.length}件, 同時処理の最大 ${peak}, 断られた ${rs.filter((r) => r.status === 'rejected' && r.reason instanceof ai.AiLimitError).length}件`,
);
const after = await ask().then(
  () => 'ok',
  (e) => e.message,
);
log(`完了後の再呼出: ${after} (枠が戻っている)`);

console.log('--- 2. 再試行 ---');
for (const m of ['5xx-once', '429-once', '400']) {
  reset(m);
  const r = await ask().then(
    () => 'success',
    (e) => `failed: ${e.message}`,
  );
  log(`${m}: ${r}, ASK到達 ${hits.length}回, 間隔 ${hits[1] ? hits[1].at - hits[0].at : '-'}ms`);
}

console.log('--- 3. 中断 (AbortSignal) ---');
reset('slow');
let ac = new AbortController();
let p = ask(ac.signal).then(
  () => 'success',
  (e) => `failed: ${e.message}`,
);
setTimeout(() => {
  log('通信中に abort');
  ac.abort();
}, 200);
log(`通信中の中断: ${await p}`);
reset('5xx-once');
ac = new AbortController();
p = ask(ac.signal).then(
  () => 'success',
  (e) => `failed: ${e.message}`,
);
setTimeout(() => {
  log('再試行の待機中に abort');
  ac.abort();
}, 300);
log(`待機中の中断: ${await p}, ASK到達 ${hits.length}回 (再送なし)`);
reset('slow');
const room = ai.roomAiSignal('ROOM1');
p = ask(room).then(
  () => 'success',
  (e) => `failed: ${e.message}`,
);
setTimeout(() => {
  log('releaseRoomAiSlots("ROOM1") でルーム破棄');
  ai.releaseRoomAiSlots('ROOM1');
}, 200);
log(`ルーム破棄による中断: ${await p}`);
log(`破棄後の同コードの signal は新規: aborted=${ai.roomAiSignal('ROOM1').aborted}`);
server.close();
process.exit(0);
