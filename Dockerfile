FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS dev
COPY . .
ENV NODE_ENV=development
EXPOSE 80
HEALTHCHECK --interval=3s --timeout=2s --start-period=5s --retries=30 \
  CMD wget -qO- "http://127.0.0.1:${DB_ADMIN_PORT:-80}/healthz" || exit 1
CMD ["npm", "run", "dev"]

FROM base AS prod
COPY . .
RUN npm prune --omit=dev
ENV NODE_ENV=production
EXPOSE 80
HEALTHCHECK --interval=3s --timeout=2s --start-period=5s --retries=30 \
  CMD wget -qO- "http://127.0.0.1:${DB_ADMIN_PORT:-80}/healthz" || exit 1
CMD ["node", "src/index.js"]
