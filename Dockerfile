FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production PORT=47213
USER node
EXPOSE 47213
CMD ["node_modules/.bin/tsx", "server/index.ts"]
