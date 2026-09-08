import type { DatabaseSync } from "node:sqlite"

/**
 * The ingest join + write, design.md section 4.2. Pure relative to HTTP: takes already
 * schema-validated `inventory`/`report` documents and a live db, and does the join, the
 * resolver backfill, and the one-transaction-per-snapshot write. The route handler
 * (`ingest-route.ts`) owns auth (401) and ajv validation (422); this module owns the one
 * additional validation ajv can't express -- a report item with no matching inventory item is
 * also a 422, but only detectable by actually joining the two documents.
 */

export interface InventoryItem {
  repo: string
  kind: string
  name: string
  pinned: string
  pinStyle: string
  role: string
  source: string
  resolver: string
}

export interface InventoryDoc {
  repos: string[]
  readOnly: string[]
  items: InventoryItem[]
}

export interface Advisory {
  id: string
  summary: string
  severity: string
  url: string
  source: string
  affected: boolean
}

export interface ReportItem {
  key: string
  repo: string
  kind: string
  name: string
  pinned: string
  pinStyle: string
  role: string
  source: string
  latest: string | null
  latestInMajor: string | null
  gap: string
  advisoryStatus: string
  advisories: Advisory[]
  assumed: string | null
  note: string
}

export interface RepoEntry {
  dependabotAlerts:
    | "not enabled"
    | { package: string; severity: string; ghsaId: string; manifestPath: string }[]
}

export interface ReportDoc {
  generatedAt: string
  inventoryItems: number
  items: ReportItem[]
  repos: Record<string, RepoEntry>
  summary: unknown
}

export type IngestOutcome =
  | { ok: true; snapshotId: number; items: number; generatedAt: string }
  | { ok: false; status: 422; error: string }

function itemKey(repo: string, kind: string, name: string, source: string): string {
  return `${repo}|${kind}|${name}|${source}`
}

export function ingest(
  db: DatabaseSync,
  inventory: InventoryDoc,
  report: ReportDoc,
): IngestOutcome {
  // Idempotent on generatedAt (design.md section 4.2): a re-post of the same snapshot is a
  // 200 no-op, checked BEFORE any join/validation work, deliberately outside the write
  // transaction below (nothing to roll back for a read-only short-circuit).
  const existing = db
    .prepare("SELECT id FROM snapshots WHERE generatedAt = ?")
    .get(report.generatedAt) as { id: number } | undefined
  if (existing) {
    const count = db
      .prepare("SELECT COUNT(*) as c FROM items WHERE snapshotId = ?")
      .get(existing.id) as { c: number }
    return { ok: true, snapshotId: existing.id, items: count.c, generatedAt: report.generatedAt }
  }

  const inventoryByKey = new Map<string, InventoryItem>()
  for (const it of inventory.items) {
    inventoryByKey.set(itemKey(it.repo, it.kind, it.name, it.source), it)
  }

  // "a report row with no inventory item is a 422, since the report is derived from the
  // inventory" (design.md section 4.2) -- checked before the transaction opens, so a bad
  // report can never leave a half-written snapshot behind.
  for (const it of report.items) {
    if (!inventoryByKey.has(it.key)) {
      return {
        ok: false,
        status: 422,
        error: `report item has no matching inventory item: ${it.key}`,
      }
    }
  }
  const reportByKey = new Map(report.items.map((it) => [it.key, it]))

  db.exec("BEGIN")
  try {
    const snapshotResult = db
      .prepare(
        "INSERT INTO snapshots (generatedAt, inventoryItems, summary_json, ingestedAt) VALUES (?, ?, ?, ?)",
      )
      .run(
        report.generatedAt,
        report.inventoryItems,
        JSON.stringify(report.summary),
        new Date().toISOString(),
      )
    const snapshotId = Number(snapshotResult.lastInsertRowid)

    const insertItem = db.prepare(
      `INSERT INTO items
        (snapshotId, key, repo, kind, name, pinned, pinStyle, role, source, resolver,
         latest, latestInMajor, gap, advisoryStatus, advisories_json, assumed, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    // Every INVENTORY item is stored (the inventory, not the report, defines "what exists" --
    // design.md section 4.2). A report-matched item gets its report fields; an inventory-only
    // item is stored with those null and note = "not in report", never dropped.
    for (const [key, invItem] of inventoryByKey) {
      const repItem = reportByKey.get(key)
      insertItem.run(
        snapshotId,
        key,
        invItem.repo,
        invItem.kind,
        invItem.name,
        invItem.pinned,
        invItem.pinStyle,
        invItem.role,
        invItem.source,
        invItem.resolver,
        repItem?.latest ?? null,
        repItem?.latestInMajor ?? null,
        repItem?.gap ?? null,
        repItem?.advisoryStatus ?? null,
        repItem ? JSON.stringify(repItem.advisories) : null,
        repItem?.assumed ?? null,
        repItem ? repItem.note : "not in report",
      )
    }

    const insertRepo = db.prepare(
      "INSERT INTO repos (snapshotId, repo, dependabot_json) VALUES (?, ?, ?)",
    )
    for (const [repo, entry] of Object.entries(report.repos)) {
      insertRepo.run(snapshotId, repo, JSON.stringify(entry.dependabotAlerts))
    }

    db.exec("COMMIT")
    return {
      ok: true,
      snapshotId,
      items: inventoryByKey.size,
      generatedAt: report.generatedAt,
    }
  } catch (err) {
    db.exec("ROLLBACK")
    throw err
  }
}
