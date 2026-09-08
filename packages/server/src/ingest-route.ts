import { timingSafeEqual } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import { firstErrorPath, validateInventory, validateReport } from "@kenzen/contract"
import type { Context, Hono } from "hono"
import type { InventoryDoc, ReportDoc } from "./ingest.js"
import { ingest } from "./ingest.js"
import type { Logger } from "./log.js"

export const API_VERSION = 1

export interface MountIngestOptions {
  db: DatabaseSync
  ingestToken: string
  log: Logger
}

/**
 * `timingSafeEqual` throws on a length mismatch rather than returning false, and a naive
 * `try { timingSafeEqual(...) } catch { return false }` would let a length mismatch return
 * faster than a same-length wrong-value mismatch -- a timing side-channel on token length.
 * Compares the received token against itself first so the length check and the value check
 * both always run one `timingSafeEqual` call, whichever branch is taken.
 */
function constantTimeEqual(received: string, expected: string): boolean {
  const receivedBuf = Buffer.from(received)
  const expectedBuf = Buffer.from(expected)
  if (receivedBuf.length !== expectedBuf.length) {
    timingSafeEqual(receivedBuf, receivedBuf)
    return false
  }
  return timingSafeEqual(receivedBuf, expectedBuf)
}

function errorBody(error: string, path?: string): Record<string, unknown> {
  return path === undefined
    ? { apiVersion: API_VERSION, error }
    : { apiVersion: API_VERSION, error, path }
}

/**
 * `POST /api/ingest`, design.md section 4.2. Auth (bearer token, constant-time compare) and
 * ajv schema validation live here; the join/backfill/write logic lives in `ingest.ts` so it
 * unit-tests without HTTP or auth in the way.
 */
export function mountIngestRoute(app: Hono, options: MountIngestOptions): void {
  app.post("/api/ingest", async (c: Context) => {
    const authHeader = c.req.header("authorization") ?? ""
    const match = /^Bearer (.+)$/.exec(authHeader)
    const token = match?.[1] ?? ""
    if (token === "" || !constantTimeEqual(token, options.ingestToken)) {
      return c.json(errorBody("unauthorized"), 401)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorBody("body must be valid JSON"), 422)
    }
    if (typeof body !== "object" || body === null) {
      return c.json(errorBody("body must be a JSON object"), 422)
    }

    const { apiVersion, inventory, report } = body as {
      apiVersion?: unknown
      inventory?: unknown
      report?: unknown
    }
    if (apiVersion !== 1) {
      return c.json(errorBody(`unsupported apiVersion: ${JSON.stringify(apiVersion)}`), 422)
    }

    const inventoryResult = validateInventory(inventory)
    if (!inventoryResult.valid) {
      return c.json(
        errorBody("inventory failed schema validation", firstErrorPath(inventoryResult.errors)),
        422,
      )
    }
    const reportResult = validateReport(report)
    if (!reportResult.valid) {
      return c.json(
        errorBody("report failed schema validation", firstErrorPath(reportResult.errors)),
        422,
      )
    }

    const outcome = ingest(options.db, inventory as InventoryDoc, report as ReportDoc)
    if (!outcome.ok) {
      options.log.warn("ingest rejected", { error: outcome.error })
      return c.json(errorBody(outcome.error), 422)
    }

    if (outcome.duplicateInventoryKeys > 0) {
      options.log.warn("ingest: duplicate inventory keys collapsed", {
        count: outcome.duplicateInventoryKeys,
      })
    }
    options.log.info("ingest accepted", { snapshotId: outcome.snapshotId, items: outcome.items })
    return c.json(
      {
        apiVersion: API_VERSION,
        snapshotId: outcome.snapshotId,
        items: outcome.items,
        generatedAt: outcome.generatedAt,
      },
      200,
    )
  })
}
