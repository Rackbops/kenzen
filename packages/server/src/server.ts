import { serve } from "@hono/node-server"
import type { Logger } from "@rackbops/node-app-kit/log"
import type { Hono } from "hono"

/**
 * Binds a Hono app to a real port via `@hono/node-server`. Copied from
 * `Rackbops/artifact-console`'s `packages/host/src/server.ts` (design.md section 3), already
 * fully generic. Resolves once listening with the actual port (so tests can bind port 0) and a
 * `close()` for graceful shutdown.
 */

export interface ServerHandle {
  port: number
  close: () => Promise<void>
}

export interface StartOptions {
  host: string
  port: number
  log: Logger
}

export function startServer(app: Hono, options: StartOptions): Promise<ServerHandle> {
  return new Promise((resolveHandle, rejectHandle) => {
    const server = serve(
      { fetch: app.fetch, hostname: options.host, port: options.port },
      (info) => {
        options.log.info("server listening", { host: options.host, port: info.port })
        resolveHandle({
          port: info.port,
          close: () =>
            new Promise<void>((res, rej) => {
              // Drop idle keep-alive sockets so close() resolves promptly instead of waiting on
              // them (otherwise a graceful shutdown hangs until the orchestrator SIGKILLs).
              ;(server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.()
              server.close((err) => (err ? rej(err) : res()))
            }),
        })
      },
    )
    // A listen failure (e.g. EADDRINUSE) arrives as an 'error' event; without this handler Node
    // throws it as unhandled and prints a raw stack. Reject so the caller exits cleanly.
    server.on("error", (err: Error) => {
      options.log.error("server error", { error: err.message })
      rejectHandle(err)
    })
  })
}
