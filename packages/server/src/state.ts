import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { openDatabase } from "./db.js"
import type { Logger } from "./log.js"
import { migrate } from "./migrate.js"

/**
 * Opens the state database and applies migrations -- the boot-time assembly of everything on
 * the state volume. Adapted from `Rackbops/artifact-console`'s `packages/host/src/state.ts`
 * (design.md section 3); drops the settings service (`settings.ts` doesn't exist here -- no
 * config-overlay concept in Kenzen yet). Logs `state ready` with the schema version (the
 * "reports the schema version" contract, kenzen#5's own acceptance bullet) and returns it.
 * Creates the state directory if missing (a fresh volume), skipping that for `:memory:`.
 */

export interface State {
  db: DatabaseSync
  schemaVersion: number
}

export interface OpenStateOptions {
  dbFile: string
  migrationsDir: string
  log: Logger
}

export function openState(options: OpenStateOptions): State {
  if (options.dbFile !== ":memory:") {
    mkdirSync(dirname(options.dbFile), { recursive: true })
  }
  const db = openDatabase(options.dbFile)
  const schemaVersion = migrate(db, options.migrationsDir)
  options.log.info("state ready", { dbFile: options.dbFile, schemaVersion })
  return { db, schemaVersion }
}
