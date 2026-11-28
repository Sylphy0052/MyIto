#!/usr/bin/env bash
# 公開コンテナの入れ替え。使い方は docs/knowledge/deploy-redeploy-live-container.md
# 手順: ビルド → 旧コンテナを docker stop -t 10 で止めて削除 → docker compose up -d → /healthz で成功判定
# 遊んでいる人がいないかの確認は人が先に行う (このスクリプトは確認しない)
#
# 環境変数:
#   HOST_PORT                  公開ポート (既定 47213)
#   COMPOSE_PROJECT_NAME       compose のプロジェクト名 (公開用は手順書の値を渡す)
#   OLD_CONTAINERS             compose 管理外の旧コンテナ名 (空白区切り。単発 run で起動した古いものなど)
#   HEALTH_TIMEOUT             /healthz を待つ秒数 (既定 60)
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "不明な引数: $arg (使えるのは --dry-run)" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

export HOST_PORT="${HOST_PORT:-47213}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
GIT_COMMIT="$(git rev-parse HEAD)"
export GIT_COMMIT

run() {
  echo "+ $*"
  if [ "$DRY_RUN" -eq 0 ]; then "$@"; fi
}

echo "HOST_PORT=$HOST_PORT GIT_COMMIT=$GIT_COMMIT"

# 1. ビルド。失敗したら set -e で止まり、旧コンテナは触らない
run docker compose build

# 2. 旧コンテナを SIGTERM で止めて (終了告知を出させる) から削除する。docker rm -f は使わない
for name in ${OLD_CONTAINERS:-}; do
  run docker stop -t 10 "$name"
  run docker rm "$name"
done
run docker compose stop -t 10 ito
run docker compose rm -f ito

# 3. 起動
run docker compose up -d ito

# 4. 起動確認
if [ "$DRY_RUN" -eq 1 ]; then
  echo "+ curl -fsS http://localhost:$HOST_PORT/healthz  (最大${HEALTH_TIMEOUT}秒待つ)"
  echo "+ イメージのラベル org.opencontainers.image.revision が $GIT_COMMIT か確かめる"
  exit 0
fi

ok=0
for _ in $(seq 1 "$HEALTH_TIMEOUT"); do
  if curl -fsS "http://localhost:$HOST_PORT/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
docker ps --filter "publish=$HOST_PORT"
if [ "$ok" -ne 1 ]; then
  echo "失敗: ${HEALTH_TIMEOUT}秒待っても /healthz が200を返さない" >&2
  docker compose logs --tail 50 ito >&2 || true
  exit 1
fi

# 5. 版の確認 (server/のソースを見ず、イメージのラベルを読む)
container_id="$(docker compose ps -q ito)"
rev="$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$container_id")"
echo "起動中のコンテナの版: $rev"
if [ "$rev" != "$GIT_COMMIT" ]; then
  echo "失敗: 版が $GIT_COMMIT と一致しない" >&2
  exit 1
fi
echo "成功: http://localhost:$HOST_PORT/healthz が200、版は $GIT_COMMIT"
