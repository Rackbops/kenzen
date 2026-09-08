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
    expect(cfg.stateDir).toBe("/state")
    expect(cfg.dbFile).toBe("/state/kenzen.db")
  })

  it("KENZEN_STATE_DIR relocates the db file and must be absolute", () => {
    expect(
      resolveConfig(
        { KENZEN_STATE_DIR: "/data/kenzen" },
        opts(() => null),
      ).dbFile,
    ).toBe("/data/kenzen/kenzen.db")
    expect(() =>
      resolveConfig(
        { KENZEN_STATE_DIR: "relative/state" },
        opts(() => null),
      ),
    ).toThrow(/KENZEN_STATE_DIR must be an absolute path, got: relative\/state/)
  })

  it("reads state_dir from config.toml when KENZEN_STATE_DIR is unset", () => {
    const cfg = resolveConfig(
      {},
      opts(() => 'state_dir = "/srv/state"\n'),
    )
    expect(cfg.dbFile).toBe("/srv/state/kenzen.db")
  })

  it("an empty KENZEN_STATE_DIR falls through to the default rather than throwing", () => {
    const cfg = resolveConfig(
      { KENZEN_STATE_DIR: "" },
      opts(() => null),
    )
    expect(cfg.stateDir).toBe("/state")
  })

  it("a blank KENZEN_STATE_DIR plus a bad relative state_dir in the file blames the file, not the env var", () => {
    expect(() =>
      resolveConfig(
        { KENZEN_STATE_DIR: "" },
        opts(() => 'state_dir = "rel/path"\n'),
      ),
    ).toThrow(/\[state_dir\] must be an absolute path, got: rel\/path/)
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

  // A set-but-blank value (a common env-file/compose slip) must be treated as unset for
  // EVERY field, not just KENZEN_HOST -- an adversarial review on K4-2 found this asymmetry
  // inherited from artifact-console's own config.ts and asked for it to be fixed here.
  it("an empty KENZEN_CONFIG_DIR falls through to the default dir rather than throwing", () => {
    const cfg = resolveConfig(
      { KENZEN_CONFIG_DIR: "" },
      opts(() => null),
    )
    expect(cfg.configFile).toBe("/config/config.toml")
  })

  it("an empty KENZEN_PORT falls through to config.toml's port rather than throwing", () => {
    const cfg = resolveConfig(
      { KENZEN_PORT: "" },
      opts(() => "port = 9000\n"),
    )
    expect(cfg.port).toBe(9000)
  })

  it("an empty KENZEN_STATIC_DIR falls through to config.toml's static_dir, not the default, and not a throw", () => {
    const cfg = resolveConfig(
      { KENZEN_STATIC_DIR: "" },
      opts(() => 'static_dir = "/srv/from-file"\n'),
    )
    expect(cfg.staticDir).toBe("/srv/from-file")
  })

  it("a blank KENZEN_STATIC_DIR plus a bad relative static_dir in the file blames the file, not the env var", () => {
    expect(() =>
      resolveConfig(
        { KENZEN_STATIC_DIR: "" },
        opts(() => 'static_dir = "rel/path"\n'),
      ),
    ).toThrow(/\[static_dir\] must be an absolute path, got: rel\/path/)
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
