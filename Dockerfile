# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:24-alpine AS deps-prod
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM node:24-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=development
EXPOSE 80
HEALTHCHECK --interval=3s --timeout=2s --start-period=5s --retries=30 \
  CMD wget -qO- "http://127.0.0.1:${DB_ADMIN_PORT:-80}/healthz" || exit 1
CMD ["npm", "run", "dev"]

FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps-prod /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 80
HEALTHCHECK --interval=3s --timeout=2s --start-period=5s --retries=30 \
  CMD wget -qO- "http://127.0.0.1:${DB_ADMIN_PORT:-80}/healthz" || exit 1
CMD ["node", "src/index.js"]
