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
# Produce the optimized .next production build and the bundled bot.
FROM deps AS build
WORKDIR /app
COPY . .
# next.config.ts reads this while it builds, so the build stage has to see it.
ARG CLOUDFLARE_WEB_ANALYTICS
ENV CLOUDFLARE_WEB_ANALYTICS=$CLOUDFLARE_WEB_ANALYTICS
# Makes next.config.ts emit .next/standalone: a self-contained server.js plus
# only the node_modules files the app actually loads. Set here rather than in
# next.config.ts so a local `pnpm build && pnpm start` keeps working as before.
ENV NEXT_OUTPUT_STANDALONE=1
RUN pnpm build
# The bot runs from one bundled file, so the runner needs no node_modules,
# TypeScript sources or tsx for it.
RUN pnpm bot:build

# ── runner ────────────────────────────────────────────────────────────
# Lean production image: no build toolchain, no dev dependencies, no source.
# Serves both the app (`pnpm start`) and the bot (`pnpm bot:start`) via
# command override.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# The standalone server binds to $HOSTNAME, which Docker sets to the container
# id. Listen on every interface so the port mapping and HEALTHCHECK reach it.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# pnpm checks node_modules against a lockfile before running a script and
# installs when they differ. The image has no lockfile, by design: its
# node_modules is the traced standalone set. Without this, `pnpm start` would
# try to reinstall on every start and fail on the read-only app directory.
ENV pnpm_config_verify_deps_before_run=false
# Bring the base image's OS packages current before anything else. The
# `node:22-alpine` tag floats to the latest Node 22 patch, but Alpine's package
# index is refreshed more often than the image is re-cut, so an explicit upgrade
# is what keeps the shipped packages level with upstream. Its own layer, ahead
# of the app COPY, so it caches independently. The image scan in
# publish-image.yml enforces this on release builds.
RUN apk upgrade --no-cache
# Create non-root user before COPY so --chown can reference it. pnpm stays so
# `pnpm start` and `pnpm bot:start` keep working as start commands for existing
# deployments and compose files. npm itself is only needed to install pnpm, so
# it is removed afterwards along with its cache.
RUN npm install -g pnpm@11.6.0 \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/lib/node_modules/corepack /usr/local/bin/corepack /root/.npm \
  && addgroup -S app && adduser -S app -G app \
  && mkdir -p /data && chown app:app /data

# Only what runs in production. --chown sets ownership during the layer
# transfer, so there is no separate chown -R pass.
#  - .next/standalone: server.js, the compiled server and its traced node_modules
#  - .next/static and public: served by server.js, not included in standalone
#  - drizzle: SQL migrations, applied at startup by instrumentation.ts
#  - lib/marketing/fonts: read from disk when OG images render
#  - dist/bot.cjs: the bundled bot
#  - docker/runtime.package.json: maps `start` and `bot:start` to the above
COPY --chown=app:app --from=build /app/.next/standalone ./
COPY --chown=app:app --from=build /app/.next/static ./.next/static
COPY --chown=app:app --from=build /app/public ./public
COPY --chown=app:app --from=build /app/drizzle ./drizzle
COPY --chown=app:app --from=build /app/lib/marketing/fonts ./lib/marketing/fonts
COPY --chown=app:app --from=build /app/dist/bot.cjs ./bot.cjs
COPY --chown=app:app --from=build /app/docker/runtime.package.json ./package.json
USER app

EXPOSE 3000
# Probes the app's health endpoint. The bot container reuses this image with a
# command override and serves no HTTP — compose disables the check for it
# (healthcheck: disable) rather than this image skipping it for everyone.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["pnpm", "start"]
