# Root Dockerfile — builds apps/dashboard (TanStack Start, the primary app).
# Built from the repo root (context: .) so both apps/dashboard/ and the shared
# packages/ sources (resolved via ../../ Vite aliases) are reachable.
#
# apps/dashboard installs in ISOLATION (its own pnpm-lock.yaml + pnpm-workspace.yaml;
# NOT a member of the repo-root workspace) — its vite bundling resolves shared
# @chm/* package deps from the app's own node_modules, so the install must happen
# inside the app dir.
#
# pnpm is the package manager (via corepack); bun stays only as the runtime for
# the node build entrypoint (scripts/build-node-ci.ts), so the bun binary is
# copied into the node-based build image.
ARG GITHUB_SHA=unknown
ARG GITHUB_REF=unknown
ARG VITE_DEPLOY_TARGET=unknown

FROM oven/bun:1-alpine AS bunbin

FROM node:24-alpine AS base
WORKDIR /app
COPY --from=bunbin /usr/local/bin/bun /usr/local/bin/bun
RUN apk add --no-cache libstdc++ libgcc && \
    corepack enable && corepack prepare pnpm@10.18.0 --activate

# ── deps ──────────────────────────────────────────────────────────────────
# Install the isolated app's own dependencies. packages/ is copied so pnpm can
# resolve the ../../packages/* workspace members during the frozen install.
FROM base AS deps
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat
COPY apps/dashboard/package.json apps/dashboard/pnpm-lock.yaml apps/dashboard/pnpm-workspace.yaml ./apps/dashboard/
COPY packages/ ./packages/
WORKDIR /app/apps/dashboard
RUN pnpm install --frozen-lockfile --ignore-scripts

# ── builder ────────────────────────────────────────────────────────────────
FROM base AS builder
ARG GITHUB_SHA
ARG GITHUB_REF
ARG VITE_DEPLOY_TARGET
ENV NODE_ENV=production \
    GITHUB_SHA=${GITHUB_SHA} \
    GITHUB_REF=${GITHUB_REF} \
    BUILD_TARGET=node \
    VITE_DEPLOY_TARGET=${VITE_DEPLOY_TARGET}
# packages/ is needed at build time for the @chm/* source aliases (../../).
COPY packages/ /app/packages/
# tsconfig.base.json lives at the repo root and is extended by apps/dashboard/tsconfig.json.
COPY tsconfig.base.json /app/tsconfig.base.json
# design-system/ is needed at build time: docs-theme.css @imports
# ../../../../../../design-system/docs-tokens.css, which Vite/PostCSS resolve
# during `pnpm run build:node:ci`. Without this the Docker build fails with a
# "Can't resolve .../design-system/docs-tokens.css" error (it's outside apps/dashboard/).
COPY design-system/ /app/design-system/
COPY apps/dashboard/ /app/apps/dashboard/
COPY --from=deps /app/apps/dashboard/node_modules /app/apps/dashboard/node_modules
WORKDIR /app/apps/dashboard
# BUILD_TARGET=node switches vite.config.ts to the Nitro node-server preset,
# emitting a self-contained bundle at .output/server/index.mjs.
#
# Use the build:node:ci wrapper, NOT a bare `vite build`: the prerender crawl
# finishes writing `.output` but the process never exits (nitro's in-process
# render server leaves a ref'd socket open), which would hang `RUN` until the
# CI/Docker timeout. The wrapper detects completion (prerender marker + on-disk
# artifacts) and reaps the lingering process group, exiting cleanly.
RUN pnpm run build:node:ci

# ── runner ─────────────────────────────────────────────────────────────────
# The Nitro node-server output is a plain Node bundle — run on node:24-alpine
# (smaller than the bun image, no runtime deps needed beyond .output).
FROM node:24-alpine AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
RUN apk add --no-cache libc6-compat curl && \
    addgroup -S -g 1001 app && \
    adduser -S -u 1001 -G app app && \
    mkdir -p /app && \
    chown -R app:app /app
WORKDIR /app
COPY --from=builder --chown=app:app /app/apps/dashboard/.output ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=30s \
  CMD curl -sf http://localhost:3000/healthz || exit 1
CMD ["node", "server/index.mjs"]
