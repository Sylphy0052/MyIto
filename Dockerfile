FROM node:22-slim

# AIお題生成用。ツールは無効化して呼ぶ (server/ai.ts)
RUN npm install -g @anthropic-ai/claude-code && npm cache clean --force

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production PORT=47213
USER node
EXPOSE 47213
CMD ["node_modules/.bin/tsx", "server/index.ts"]
