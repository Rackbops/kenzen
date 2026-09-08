import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createLogger } from "@rackbops/node-app-kit/log"
import { openState } from "@rackbops/node-app-kit/state"
import { getVersion } from "@rackbops/node-app-kit/version"
import { createRemoteJWKSet } from "jose"
import type { VerifyAccessJwt } from "./access-identity.js"
import { createAccessJwtVerifier, normalizeTeamDomain } from "./access-identity.js"
import { createApp } from "./app.js"
import { resolveConfig } from "./config.js"
import { startServer } from "./server.js"

/**
 * The executable entry (`node dist/main.js`). Thin wiring only, matching
 * `Rackbops/artifact-console`'s `main.ts`: resolve config + log it, open state (migrating on
 * boot, K4-3), build the app, start listening, install graceful-shutdown signal handlers. The
 * logic lives in the tested modules above -- this file has no dedicated unit test, same as
 * artifact-console's; verified instead by actually running it (K4-2's acceptance:
 * `curl :8686/healthz`, the boot log line, the relative-KENZEN_CONFIG_DIR rejection; K4-3's:
 * a second boot applying zero migrations; K4-4's: ingesting the real Tooling files and a
 * missing KENZEN_INGEST_TOKEN refusing to start).
 */

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

/**
 * KENZEN_INGEST_TOKEN is a secret (design.md section 4.2: "generated once... never in either
 * repo"), so unlike host/port/staticDir/stateDir it has no config.toml fallback and no
 * built-in default -- it is read directly from the environment, not threaded through
 * `resolveConfig`. This is the first genuinely-required field `config.ts`'s own docstring
 * anticipated back in K4-2: refusing to start when it's absent is the app-config standard's
 * "refuses to start only when config is absent everywhere" finally made concrete.
 */
function requireIngestToken(env: Record<string, string | undefined>): string {
  const token = env.KENZEN_INGEST_TOKEN
  if (token === undefined || token === "") {
    throw new Error("KENZEN_INGEST_TOKEN is not set -- ingest cannot be authenticated")
  }
  return token
}

/**
 * `undefined` when Access isn't configured (config.ts already enforces both-or-neither on
 * `accessTeamDomain`/`accessAud`) -- `PUT /api/decisions/*` then refuses every JWT it sees
 * rather than pretending to verify one, matching the bot's own admin panel behavior for the
 * same unconfigured case.
 */
function buildAccessVerifier(
  accessTeamDomain: string | undefined,
  accessAud: string | undefined,
): VerifyAccessJwt | undefined {
  if (accessTeamDomain === undefined || accessAud === undefined) {
    return undefined
  }
  const teamDomain = normalizeTeamDomain(accessTeamDomain)
  const jwksUrl = new URL(`https://${teamDomain}/cdn-cgi/access/certs`)
  return createAccessJwtVerifier(createRemoteJWKSet(jwksUrl), teamDomain, accessAud)
}

async function main(): Promise<void> {
  const log = createLogger()
  const here = dirname(fileURLToPath(import.meta.url))
  const defaultStaticDir = resolve(here, "../public")

  // defaultPort is explicit (not relying on @rackbops/node-app-kit's own hardcoded 8686
  // fallback matching Kenzen's own default by coincidence) -- Rackbops/kenzen#46, following
  // Rackbops/artifact-console#161's real, live example of that coincidence breaking a different
  // consumer whose default genuinely differs (Rackbops/rackbops-node-app-kit#3).
  const config = resolveConfig(process.env, {
    readFile: readFileOrNull,
    defaultStaticDir,
    defaultPort: 8686,
  })
  log.info("config resolved", {
    source: config.configSource,
    configFile: config.configFile,
    host: config.host,
    port: config.port,
    staticDir: config.staticDir,
    stateDir: config.stateDir,
    accessConfigured: config.accessTeamDomain !== undefined,
    devIdentityConfigured: config.devIdentity !== undefined,
  })

  // migrations/ ships as a sibling of both src/ and dist/ (never compiled/copied by tsc), so
  // this resolves the same absolute path whether main.ts runs from source or from dist/ --
  // but the image (K4-6) must COPY it explicitly, or boot 404s with ENOENT (migrations/README.md).
  const migrationsDir = resolve(here, "../migrations")
  const state = openState({ dbFile: config.dbFile, migrationsDir, log })
  process.on("exit", () => {
    try {
      state.db.close()
    } catch {
      // best-effort WAL flush on exit
    }
  })

  const ingestToken = requireIngestToken(process.env)
  const verifyAccessJwt = buildAccessVerifier(config.accessTeamDomain, config.accessAud)
  const app = createApp({
    version: getVersion(import.meta.url),
    staticDir: config.staticDir,
    db: state.db,
    ingestToken,
    log,
    verifyAccessJwt,
    devIdentity: config.devIdentity,
  })
  const handle = await startServer(app, { host: config.host, port: config.port, log })

  const shutdown = (signal: string): void => {
    log.info("shutting down", { signal })
    handle
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  }
  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
}

main().catch((err: unknown) => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
  process.stderr.write(`fatal: ${detail}\n`)
  process.exit(1)
})
