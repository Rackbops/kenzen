import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { createLogger } from "./log.js"
import { openState } from "./state.js"

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations")
const silent = createLogger({ write: () => {} })
const dirs: string[] = []

function tempDbFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "kenzen-state-"))
  dirs.push(dir)
  return join(dir, "sub", "kenzen.db") // the 'sub' segment exercises mkdir -p on a fresh volume
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true })
  }
})

describe("openState", () => {
  // Backs kenzen#5's acceptance bullet: "second boot applies zero migrations and reports the
  // schema version," exercised through the real boot-time path (a real file, a real re-open),
  // not just migrate() directly.
  it("creates the db, migrates, and a re-open applies zero migrations", () => {
    const dbFile = tempDbFile()
    const first = openState({ dbFile, migrationsDir, log: silent })
    expect(first.schemaVersion).toBeGreaterThanOrEqual(1)
    expect(existsSync(dbFile)).toBe(true)
    first.db.close()

    const second = openState({ dbFile, migrationsDir, log: silent })
    expect(second.schemaVersion).toBe(first.schemaVersion)
    second.db.close()
  })

  it("a real-file database uses WAL and enforces foreign keys", () => {
    const state = openState({ dbFile: tempDbFile(), migrationsDir, log: silent })
    const journal = state.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }
    const fk = state.db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }
    expect(journal.journal_mode).toBe("wal")
    expect(fk.foreign_keys).toBe(1)
    state.db.close()
  })

  it("logs 'state ready' with the schema version", () => {
    const lines: string[] = []
    const log = createLogger({ write: (l) => lines.push(l) })
    const state = openState({ dbFile: ":memory:", migrationsDir, log })
    const record = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((r) => r.msg === "state ready")
    expect(record).toBeDefined()
    expect(record?.schemaVersion).toBe(state.schemaVersion)
    state.db.close()
  })

  it("wires the real migrations dir into a working schema", () => {
    const state = openState({ dbFile: ":memory:", migrationsDir, log: silent })
    // Excludes sqlite_% : SQLite's own internal bookkeeping (sqlite_sequence, created
    // automatically by any AUTOINCREMENT column), not part of 0001_init.sql's own schema.
    const tables = state.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual([
      "decision_history",
      "decisions",
      "items",
      "repos",
      "snapshots",
    ])
    state.db.close()
  })
})
