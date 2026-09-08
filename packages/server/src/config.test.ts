import { describe, expect, it } from "vitest"
import { resolveConfig } from "./config.js"

const opts = (readFile: (path: string) => string | null) => ({
  readFile,
  defaultStaticDir: "/app/public",
})

describe("resolveConfig", () => {
  it("falls through to defaults with no env and no config file", () => {
    const cfg = resolveConfig(
      {},
      opts(() => null),
    )
    expect(cfg.host).toBe("127.0.0.1")
    expect(cfg.port).toBe(8686)
    expect(cfg.staticDir).toBe("/app/public")
    expect(cfg.configFile).toBe("/config/config.toml")
    expect(cfg.configSource).toBe("defaults")
  })

  it("reads host/port/static_dir from config.toml when present", () => {
    const toml = 'host = "0.0.0.0"\nport = 9000\nstatic_dir = "/srv/spa"\n'
    const cfg = resolveConfig(
      {},
      opts((p) => (p === "/config/config.toml" ? toml : null)),
    )
    expect(cfg.host).toBe("0.0.0.0")
    expect(cfg.port).toBe(9000)
    expect(cfg.staticDir).toBe("/srv/spa")
    expect(cfg.configSource).toBe("file")
  })

  it("KENZEN_* env overrides both the file and the defaults", () => {
    const toml = 'host = "0.0.0.0"\nport = 9000\n'
    const cfg = resolveConfig(
      { KENZEN_HOST: "10.0.0.1", KENZEN_PORT: "1234", KENZEN_STATIC_DIR: "/srv/env" },
      opts(() => toml),
    )
    expect(cfg.host).toBe("10.0.0.1")
    expect(cfg.port).toBe(1234)
    expect(cfg.staticDir).toBe("/srv/env")
  })

  it("an empty KENZEN_HOST falls through to the default rather than binding blank", () => {
    const cfg = resolveConfig(
      { KENZEN_HOST: "" },
      opts(() => null),
    )
    expect(cfg.host).toBe("127.0.0.1")
  })

  // The acceptance bullet this backs: "a relative KENZEN_CONFIG_DIR rejected with a clear error."
  it("KENZEN_CONFIG_DIR relocates the config file and must be absolute", () => {
    expect(
      resolveConfig(
        { KENZEN_CONFIG_DIR: "/etc/kenzen" },
        opts(() => null),
      ).configFile,
    ).toBe("/etc/kenzen/config.toml")
    expect(() =>
      resolveConfig(
        { KENZEN_CONFIG_DIR: "relative/dir" },
        opts(() => null),
      ),
    ).toThrow(/KENZEN_CONFIG_DIR must be an absolute path, got: relative\/dir/)
  })

  it("KENZEN_STATIC_DIR must be absolute", () => {
    expect(() =>
      resolveConfig(
        { KENZEN_STATIC_DIR: "rel/spa" },
        opts(() => null),
      ),
    ).toThrow(/absolute/)
  })

  it("rejects an out-of-range or non-numeric KENZEN_PORT (no silent truncation)", () => {
    expect(() =>
      resolveConfig(
        { KENZEN_PORT: "70000" },
        opts(() => null),
      ),
    ).toThrow(/1-65535/)
    expect(() =>
      resolveConfig(
        { KENZEN_PORT: "8080abc" },
        opts(() => null),
      ),
    ).toThrow(/1-65535/)
  })

  it("rejects an out-of-range port from config.toml instead of silently defaulting", () => {
    expect(() =>
      resolveConfig(
        {},
        opts(() => "port = 0\n"),
      ),
    ).toThrow(/1-65535/)
  })

  it("raises a clear, config-file-named error on invalid TOML rather than a raw parser error", () => {
    expect(() =>
      resolveConfig(
        {},
        opts(() => "not = valid = toml"),
      ),
    ).toThrow(/failed to parse \/config\/config\.toml/)
  })
})
