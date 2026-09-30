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
# NEXT_PUBLIC_* are inlined into the browser bundle at build time; the DSN is
# ingest-only and public by design, so a build arg is the right home for it.
ARG BUILD_SHA=dev
ARG NEXT_PUBLIC_SENTRY_DSN=
ENV BUILD_SHA=$BUILD_SHA NEXT_PUBLIC_BUILD_SHA=$BUILD_SHA NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
# Debug IDs are stamped offline here; the upload is CI's `sourcemaps` job,
# never this build (ADR-0010 as amended 2026-09-30).
RUN npm run build && sh scripts/sourcemaps.sh inject /sourcemaps

# --- sourcemaps: exported by CI (`--target sourcemaps --output`), never run ---
FROM scratch AS sourcemaps
COPY --from=build /sourcemaps /

# --- app: minimal standalone runtime ---
FROM node:24-alpine AS app
WORKDIR /app
ARG BUILD_SHA=dev
ENV NODE_ENV=production BUILD_SHA=$BUILD_SHA
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]

# --- worker: full deps (tsx runtime) ---
FROM node:24-alpine AS worker
WORKDIR /app
ARG BUILD_SHA=dev
ENV NODE_ENV=production BUILD_SHA=$BUILD_SHA
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npx", "tsx", "src/worker/index.ts"]
