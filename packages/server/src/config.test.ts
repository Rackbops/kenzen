import { describe, expect, it } from "vitest"
import { resolveConfig } from "./config.js"

// The generic fields (host/port/dirs/dbFile/blank-env-handling/prefix behaviour) are
// @rackbops/node-app-kit's own coverage now -- see that package's config.test.ts, which carries
// forward every one of Kenzen's original KENZEN_*-prefixed assertions plus the #145 blank-env
// regression tests, proven byte-identical for prefix "KENZEN". This file covers only what's
// genuinely Kenzen's own: the Access-identity fields this wrapper adds.

const opts = (readFile: (path: string) => string | null) => ({
  readFile,
  defaultStaticDir: "/app/public",
})

describe("resolveConfig", () => {
  it("delegates the base fields to the shared package with prefix KENZEN", () => {
    const cfg = resolveConfig(
      { KENZEN_HOST: "10.0.0.1" },
      opts(() => null),
    )
    expect(cfg.host).toBe("10.0.0.1")
    expect(cfg.dbFile).toBe("/state/kenzen.db")
  })

  it("leaves Access verification unconfigured when neither KENZEN_ACCESS_* var is set", () => {
    const cfg = resolveConfig(
      {},
      opts(() => null),
    )
    expect(cfg.accessTeamDomain).toBeUndefined()
    expect(cfg.accessAud).toBeUndefined()
  })

  it("reads KENZEN_ACCESS_TEAM_DOMAIN/KENZEN_ACCESS_AUD when both are set", () => {
    const cfg = resolveConfig(
      { KENZEN_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", KENZEN_ACCESS_AUD: "aud-123" },
      opts(() => null),
    )
    expect(cfg.accessTeamDomain).toBe("team.cloudflareaccess.com")
    expect(cfg.accessAud).toBe("aud-123")
  })

  it("throws when only one of KENZEN_ACCESS_TEAM_DOMAIN/KENZEN_ACCESS_AUD is set (fail loud, not half-verified)", () => {
    expect(() =>
      resolveConfig(
        { KENZEN_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com" },
        opts(() => null),
      ),
    ).toThrow(/KENZEN_ACCESS_TEAM_DOMAIN and KENZEN_ACCESS_AUD must be set together/)
    expect(() =>
      resolveConfig(
        { KENZEN_ACCESS_AUD: "aud-123" },
        opts(() => null),
      ),
    ).toThrow(/KENZEN_ACCESS_TEAM_DOMAIN and KENZEN_ACCESS_AUD must be set together/)
  })

  it("treats a blank KENZEN_ACCESS_AUD as unset, not as 'only one set'", () => {
    const cfg = resolveConfig(
      { KENZEN_ACCESS_TEAM_DOMAIN: "", KENZEN_ACCESS_AUD: "" },
      opts(() => null),
    )
    expect(cfg.accessTeamDomain).toBeUndefined()
    expect(cfg.accessAud).toBeUndefined()
  })

  it("reads KENZEN_DEV_IDENTITY, treating a blank value as unset", () => {
    expect(
      resolveConfig(
        { KENZEN_DEV_IDENTITY: "alice" },
        opts(() => null),
      ).devIdentity,
    ).toBe("alice")
    expect(
      resolveConfig(
        { KENZEN_DEV_IDENTITY: "" },
        opts(() => null),
      ).devIdentity,
    ).toBeUndefined()
    expect(
      resolveConfig(
        {},
        opts(() => null),
      ).devIdentity,
    ).toBeUndefined()
  })
})
