# Brot server image. Build from the repository root:
#   docker build -t brot-server .
#
# The packages export TypeScript source, so the server runs through tsx. The runtime stage therefore keeps the
# workspace node_modules instead of a pruned production install.

FROM node:24-slim AS base
# pnpm is pinned by the packageManager field in package.json. Corepack fetches it without prompting in a build.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN --mount=type=cache,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production \
    BROT_HOME=/data \
    BROT_HOST=0.0.0.0 \
    BROT_PORT=8799 \
    BROT_WEBHOOK_PORT=8800
COPY --from=build /app /app
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
# The webhook listener (BROT_WEBHOOK_PORT) is internal. Publish it only when an external service must call a hook.
EXPOSE 8799
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.BROT_PORT || 8799) + '/api/health', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
