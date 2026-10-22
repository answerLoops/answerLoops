# syntax=docker/dockerfile:1

# ── deps ──────────────────────────────────────────────────────────────
# Install dependencies once, compiling native modules (better-sqlite3).
# Dev compose targets this stage so it never runs a production build.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ gcc
RUN npm install -g pnpm@11.6.0
# pnpm-workspace.yaml carries onlyBuiltDependencies so build scripts run without
# interactive approval. Lock file included when present for reproducible installs.
COPY package.json pnpm-workspace.yaml .npmrc pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ── build ─────────────────────────────────────────────────────────────
# Produce the optimized .next production build.
FROM deps AS build
WORKDIR /app
COPY . .
# next.config.ts reads this while it builds, so the build stage has to see it.
ARG CLOUDFLARE_WEB_ANALYTICS
ENV CLOUDFLARE_WEB_ANALYTICS=$CLOUDFLARE_WEB_ANALYTICS
RUN pnpm build

# ── runner ────────────────────────────────────────────────────────────
# Lean production image: no build toolchain. Serves both the app
# (`pnpm start`) and the bot (`pnpm bot:start`) via command override.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Bring the base image's OS packages current before anything else. The
# `node:22-alpine` tag floats to the latest Node 22 patch, but Alpine's package
# index is refreshed more often than the image is re-cut, so an explicit upgrade
# is what keeps the shipped packages level with upstream. Its own layer, ahead
# of the app COPY, so it caches independently. The image scan in
# publish-image.yml enforces this on release builds.
RUN apk upgrade --no-cache
# Create non-root user before COPY so --chown can reference it.
RUN npm install -g pnpm@11.6.0 \
  && addgroup -S app && adduser -S app -G app \
  && mkdir -p /data && chown app:app /data

# --chown sets ownership during the layer transfer — no separate chown -R pass
# needed, which avoids recursing through hundreds of thousands of node_modules
# inodes and causing multi-hour builds on Docker Desktop.
COPY --chown=app:app --from=build /app ./
USER app

EXPOSE 3000
# Probes the app's health endpoint. The bot container reuses this image with a
# command override and serves no HTTP — compose disables the check for it
# (healthcheck: disable) rather than this image skipping it for everyone.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["pnpm", "start"]
