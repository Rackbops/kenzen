import { createLogger } from "@rackbops/node-app-kit/log"
import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { startServer } from "./server.js"

const silentLog = () => createLogger({ write: () => {} })

describe("startServer", () => {
  it("binds an ephemeral port and actually serves the app over the network", async () => {
    const app = new Hono()
    app.get("/", (c) => c.text("ok"))
    const handle = await startServer(app, { host: "127.0.0.1", port: 0, log: silentLog() })
    try {
      expect(handle.port).toBeGreaterThan(0)
      const res = await fetch(`http://127.0.0.1:${handle.port}/`)
      expect(await res.text()).toBe("ok")
    } finally {
      await handle.close()
    }
  })

  it("rejects rather than crashing the process when the port is already in use", async () => {
    const app = new Hono()
    const log = silentLog()
    const first = await startServer(app, { host: "127.0.0.1", port: 0, log })
    try {
      await expect(startServer(app, { host: "127.0.0.1", port: first.port, log })).rejects.toThrow()
    } finally {
      await first.close()
    }
  })
})
