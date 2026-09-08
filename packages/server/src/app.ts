import type { DatabaseSync } from "node:sqlite"
import { Hono } from "hono"
import type { VerifyAccessJwt } from "./access-identity.js"
import { mountDecisionsRoute } from "./decisions-route.js"
import { mountIngestRoute } from "./ingest-route.js"
import { mountItemHistoryRoute } from "./item-history-route.js"
import type { Logger } from "./log.js"
import { mountReposRoute } from "./repos-route.js"
import { mountSnapshotsRoute } from "./snapshots-route.js"
import { spaHandler } from "./static.js"

/**
 * design.md section 4.3: every Kenzen API response carries `apiVersion: 1`; additive-only
 * contract (new fields yes, renamed or removed never). `/healthz`, `/api/ingest`, `/api/repos`
 * (K4-4), `/api/snapshots`, `/api/snapshots/:id/items`, `/api/items/:key/history` (K4-4b), and
 * `GET/PUT /api/decisions` (K4-5) all exist.
 */
export const API_VERSION = 1

export interface AppOptions {
  version: string
  staticDir: string
  db: DatabaseSync
  ingestToken: string
  log: Logger
  verifyAccessJwt?: VerifyAccessJwt
  devIdentity?: string
}

/**
 * The server's HTTP app. `GET /healthz` -> `{ok, version, apiVersion}` (design.md section 4.3);
 * `POST /api/ingest` and `GET /api/repos` (K4-4); `GET /api/snapshots`,
 * `GET /api/snapshots/:id/items`, `GET /api/items/:key/history` (K4-4b);
 * `GET/PUT /api/decisions` (K4-5); everything else is served from the SPA static dir. Pure
 * builder -- no listening -- so it unit-tests via `app.request()`.
 */
export function createApp(options: AppOptions): Hono {
  const app = new Hono()

  app.get("/healthz", (c) =>
    c.json({ ok: true, version: options.version, apiVersion: API_VERSION }),
  )
  mountIngestRoute(app, { db: options.db, ingestToken: options.ingestToken, log: options.log })
  mountReposRoute(app, options.db)
  mountSnapshotsRoute(app, options.db)
  mountItemHistoryRoute(app, options.db)
  mountDecisionsRoute(app, {
    db: options.db,
    log: options.log,
    verifyAccessJwt: options.verifyAccessJwt,
    devIdentity: options.devIdentity,
  })
  app.get("*", spaHandler(options.staticDir))

  // Without this, an error escaping a route (e.g. a real DB exception ingest.ts couldn't
  // classify as a 422, already rolled back there) falls through to Hono's own default
  // errorHandler -- a plain-text "Internal Server Error", breaking this app's own
  // "every response carries apiVersion: 1" contract on exactly the one path that most needs
  // a caller to be able to tell it got an error at all. Found by an adversarial review on
  // this PR forcing a real UNIQUE-constraint violation through the live server.
  app.onError((err, c) => {
    options.log.error("unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return c.json({ apiVersion: API_VERSION, error: "internal error" }, 500)
  })

  return app
}
