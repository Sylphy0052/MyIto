FROM node:22-slim

# AIお題生成用。ツールは無効化して呼ぶ (server/ai.ts)
RUN npm install -g @anthropic-ai/claude-code@2.1.312 && npm cache clean --force

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# claude のログイン情報を置く。compose の volume をここにマウントする
RUN mkdir -p /home/node/claude-home && chown node:node /home/node/claude-home && chmod 700 /home/node/claude-home
ENV NODE_ENV=production PORT=47213 ITO_CLAUDE_HOME=/home/node/claude-home
USER node
EXPOSE 47213
CMD ["node_modules/.bin/tsx", "server/index.ts"]
