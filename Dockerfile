# syntax=docker/dockerfile:1

# --- build: install the workspace, build server + web, bundle a production deploy dir ---
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
# One recursive build across the workspace (matching Rackbops/artifact-console's Dockerfile):
# @kenzen/server builds via tsc -> dist today; @kenzen/web has no build script yet (K4-7/K4-8
# scaffold, design.md section 3) so pnpm -r silently skips it until then -- no Dockerfile change
# needed once the real Vite build (into packages/server/public/) lands.
RUN pnpm -r build
# A self-contained dir: the server package (dist, public, migrations, package.json) + its
# production node_modules, no workspace symlinks. --legacy because @kenzen/server has no
# injected workspace deps yet (same reason artifact-console's own deploy needs it).
RUN pnpm --filter @kenzen/server deploy --prod --legacy /prod/server

# --- runtime: non-root, just the deploy bundle ---
FROM node:24-alpine AS runtime
# The container binds all interfaces so the cloudflared sidecar (or, here, the ratchet's
# published port) reaches it; config.ts's own default (127.0.0.1) is the safe fallback for a
# bare `node dist/main.js` run outside a container, not for this image.
ENV NODE_ENV=production \
    KENZEN_HOST=0.0.0.0 \
    KENZEN_CONFIG_DIR=/config \
    KENZEN_STATE_DIR=/state
WORKDIR /app
COPY --from=build /prod/server ./
RUN addgroup -g 10001 kenzen \
    && adduser -D -u 10001 -G kenzen kenzen \
    && mkdir -p /config /state \
    && chown -R kenzen:kenzen /config /state /app
USER kenzen
EXPOSE 8686
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8686/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# node:sqlite is flagless on Node 24. main.js resolves ../public, ../migrations, ../package.json
# (version.ts) -- all three must ship as siblings of dist/, or boot 404s/ENOENTs (migrations/README.md).
CMD ["node", "dist/main.js"]
