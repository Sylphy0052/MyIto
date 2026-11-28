# build段: 開発用の依存も入れて、画面 (dist/client) とサーバ (dist/server) をビルドする
FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# runtime段: 本番用の依存とビルド成果物だけを入れる (vite・typescript・tsx・esbuildは入らない)
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production PORT=47213
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

USER node
EXPOSE 47213
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 47213) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
# exec形式でnodeを直接PID 1にする。npm startやshell形式を挟むとSIGTERMがnodeへ届かない
CMD ["node", "--enable-source-maps", "dist/server/index.js"]
