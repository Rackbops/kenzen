# syntax=docker/dockerfile:1

# --- build: install the workspace, build server + web, bundle a production deploy dir ---
# --platform=$BUILDPLATFORM (kenzen#28, K4-6b): the deploy bundle is pure JS (hono,
# @hono/node-server, jose, smol-toml, node:sqlite -- no native modules), so it is
# architecture-independent and only needs building once. Without this pin, buildx's
# linux/arm64 pass runs esbuild/Vite (the K4-7 web build) under QEMU emulation, which took
# release.yml's v0.1.0-alpha.2 run from 4 minutes to over 45. Pinning the build stage to the
# builder's own (native) platform keeps `pnpm -r build` off QEMU entirely; only the runtime
# stage (a plain COPY + adduser, no compilation) still runs per target.
FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /repo
# Corepack was removed from Node core as of Node 25 -- there is no `corepack` binary to
# enable on 25+, so pnpm is installed directly instead. Reading the version from
# package.json's own packageManager field (rather than a second pin here) keeps Renovate's
# pnpm bumps flowing through the one field this repo already tracks them in.
COPY package.json ./
RUN npm install -g pnpm@"$(node -p "require('./package.json').packageManager.split('@')[1]")"
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
FROM node:26-alpine AS runtime
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
# node:sqlite is flagless on Node 24+ (verified: no breaking DatabaseSync/StatementSync changes
# through Node 26). main.js resolves ../public, ../migrations, ../package.json
# (version.ts) -- all three must ship as siblings of dist/, or boot 404s/ENOENTs (migrations/README.md).
CMD ["node", "dist/main.js"]
