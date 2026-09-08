import { Hono } from "hono"
import { spaHandler } from "./static.js"

/**
 * design.md section 4.3: every Kenzen API response carries `apiVersion: 1`; additive-only
 * contract (new fields yes, renamed or removed never). Currently only `/healthz` uses it --
 * the real read API (`/api/snapshots`, `/api/repos`, ...) lands in K4-4/K4-5.
 */
export const API_VERSION = 1

export interface AppOptions {
  version: string
  staticDir: string
}

/**
 * The server's HTTP app. `GET /healthz` -> `{ok, version, apiVersion}` (design.md section 4.3);
 * everything else is served from the SPA static dir. Pure builder -- no listening -- so it
 * unit-tests via `app.request()`.
 */
export function createApp(options: AppOptions): Hono {
  const app = new Hono()

  app.get("/healthz", (c) =>
    c.json({ ok: true, version: options.version, apiVersion: API_VERSION }),
  )
  app.get("*", spaHandler(options.staticDir))

  return app
}
