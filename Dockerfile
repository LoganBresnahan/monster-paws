# Multi-stage build (ADR-0007). Two runnable targets from one build:
#   app    — Next.js standalone server (default)
#   worker — pg-boss worker / pollers

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- app: minimal standalone runtime ---
FROM node:24-alpine AS app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]

# --- worker: full deps (tsx runtime) ---
FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npx", "tsx", "src/worker/index.ts"]
