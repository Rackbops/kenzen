import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createApp } from "./app.js"
import { resolveConfig } from "./config.js"
import { createLogger } from "./log.js"
import { startServer } from "./server.js"
import { getVersion } from "./version.js"

/**
 * The executable entry (`node dist/main.js`). Thin wiring only, matching
 * `Rackbops/artifact-console`'s `main.ts`: resolve config + log it, build the app, start
 * listening, install graceful-shutdown signal handlers. The logic lives in the tested modules
 * above -- this file has no dedicated unit test, same as artifact-console's; verified instead by
 * actually running it (K4-2's acceptance: `curl :8686/healthz`, the boot log line, the
 * relative-KENZEN_CONFIG_DIR rejection).
 */

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const log = createLogger()
  const here = dirname(fileURLToPath(import.meta.url))
  const defaultStaticDir = resolve(here, "../public")

  const config = resolveConfig(process.env, { readFile: readFileOrNull, defaultStaticDir })
  log.info("config resolved", {
    source: config.configSource,
    configFile: config.configFile,
    host: config.host,
    port: config.port,
    staticDir: config.staticDir,
  })

  const app = createApp({ version: getVersion(), staticDir: config.staticDir })
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
