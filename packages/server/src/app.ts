import type { DatabaseSync } from "node:sqlite"
import { healthz } from "@rackbops/node-app-kit/healthz"
import type { Logger } from "@rackbops/node-app-kit/log"
import { spaHandler } from "@rackbops/node-app-kit/static"
import { Hono } from "hono"
import type { VerifyAccessJwt } from "./access-identity.js"
import { mountDecisionsRoute } from "./decisions-route.js"
import { mountIngestRoute } from "./ingest-route.js"
import { mountItemHistoryRoute } from "./item-history-route.js"
import { mountReposRoute } from "./repos-route.js"
import { mountSnapshotsRoute } from "./snapshots-route.js"

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

  // K4-6c (kenzen#44): Kenzen always serves its dashboard UI -- the SPA fallback below is
  // unconditional, there is no headless/API-only mode -- so an unconfigured Access verifier
  // means PUT /api/decisions/* has no verified identity path. This PR's own review gate went
  // through two drafts that each overclaimed a specific per-request outcome (round 1: "every
  // write 401s" -- false when KENZEN_DEV_IDENTITY is set and no JWT header arrives; round 2's
  // fix for that: "writes succeed via devIdentity" -- also false, because resolveUpdatedBy in
  // decisions-route.ts (see its own doc comment) only reaches the devIdentity fallback when NO
  // Cf-Access-Jwt-Assertion header is present at all, and a real Access-gated request (the
  // live incident's own shape: Access fronts the Cloudflare tunnel per design.md section 7,
  // independently of whether this app's own KENZEN_ACCESS_TEAM_DOMAIN/AUD are set) always
  // carries that header, so it is rejected outright regardless of devIdentity --
  // decisions-route.test.ts "401s a JWT-bearing request when this instance has no verifier
  // configured" proves it even with devIdentity set). What's actually knowable at BOOT time,
  // true unconditionally, is only that no verified path exists -- so that's all this warns.
  if (options.verifyAccessJwt === undefined) {
    options.log.warn(
      "Access JWT verification is not configured -- PUT /api/decisions/* has no verified identity path (a request carrying an Access JWT header is rejected outright regardless of KENZEN_DEV_IDENTITY; set KENZEN_ACCESS_TEAM_DOMAIN and KENZEN_ACCESS_AUD)",
    )
  }

  app.get("/healthz", healthz({ version: options.version, apiVersion: API_VERSION }))
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
