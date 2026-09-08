import { parse as parseToml } from "smol-toml"

/**
 * Config resolution, precedence `KENZEN_*` env > `/config/config.toml` > defaults -- the same
 * shape as `Rackbops/artifact-console`'s `packages/host/src/config.ts` (design.md section 3).
 * `pluginsDir` doesn't apply here (no plugin system). Pure: the environment and the file reader
 * are injected, so it unit-tests without touching the real filesystem. The caller logs which
 * source was used (`configSource`) -- the app-config standard's "log which config path was
 * loaded on every start."
 *
 * No field here lacks a working built-in default (host/port/staticDir/stateDir all do), so the
 * standard's "refuses to start only when config is absent everywhere" has no live trigger yet --
 * same as artifact-console's own current config.ts, for the same reason. It becomes concrete
 * once a genuinely required field exists (e.g. K4-4's ingest token).
 */

export interface ServerConfig {
  host: string
  port: number
  configDir: string
  configFile: string
  staticDir: string
  stateDir: string
  dbFile: string
  /** Cloudflare Access team hostname (e.g. `rackbops.cloudflareaccess.com`), bare -- no
   * scheme/port/path. Both undefined or both set; JWT verification for `PUT /api/decisions/*`
   * (design.md section 11) is unconfigured (never attempted) when either is missing. */
  accessTeamDomain: string | undefined
  accessAud: string | undefined
  /** Local-dev stand-in for `updatedBy` when no Access JWT is present. Refused whenever a JWT
   * IS present (K4-5) -- never a way to bypass real verification, only to work without Access
   * in front at all. */
  devIdentity: string | undefined
}

export interface ResolvedConfig extends ServerConfig {
  /** Whether the effective config came from a config.toml or fell through to defaults. */
  configSource: "file" | "defaults"
}

export interface ResolveOptions {
  /** Reads a file's text, or returns null if it does not exist. Injected for tests. */
  readFile: (path: string) => string | null
  /** Absolute default for the SPA static dir when nothing overrides it. */
  defaultStaticDir: string
}

const DEFAULT_CONFIG_DIR = "/config"
const DEFAULT_STATE_DIR = "/state"
const DEFAULT_HOST = "127.0.0.1"
const DEFAULT_PORT = 8686

export function resolveConfig(
  env: Record<string, string | undefined>,
  options: ResolveOptions,
): ResolvedConfig {
  // A set-but-blank value (a common env-file/compose slip) is treated as unset everywhere
  // below, not just for KENZEN_HOST -- an artifact-console adversarial review on this port
  // (Tooling#478 K4-2) found that asymmetry inherited byte-for-byte from artifact-console's
  // own config.ts: KENZEN_HOST="" already fell back to the default, but
  // KENZEN_CONFIG_DIR/KENZEN_STATIC_DIR/KENZEN_PORT set to "" hard-crashed instead, and a
  // blank KENZEN_STATIC_DIR even shadowed a valid config.toml value (`??` only skips
  // null/undefined, not ""). None of that was a security issue -- failing loud beats failing
  // silently wrong -- but there's no reason the same env-file slip should be handled
  // differently depending on which field it hits.
  const configDirRaw = nonEmpty(env.KENZEN_CONFIG_DIR)
  if (configDirRaw !== undefined) {
    requireAbsolute(configDirRaw, "KENZEN_CONFIG_DIR")
  }
  const configDir = configDirRaw ?? DEFAULT_CONFIG_DIR
  const configFile = `${configDir.replace(/[\\/]+$/, "")}/config.toml`

  const fileText = options.readFile(configFile)
  const configSource: "file" | "defaults" = fileText === null ? "defaults" : "file"
  const fileConfig = fileText === null ? {} : parseConfigFile(fileText, configFile)

  // An empty host must NOT bind all interfaces -- treat it as unset so the loopback default
  // (the security floor) holds.
  const host = nonEmpty(env.KENZEN_HOST) ?? nonEmpty(asString(fileConfig.host)) ?? DEFAULT_HOST

  const portEnv = nonEmpty(env.KENZEN_PORT)
  let port: number
  if (portEnv !== undefined) {
    port = coercePort(portEnv, "KENZEN_PORT")
  } else if ("port" in fileConfig) {
    port = coercePort(fileConfig.port, `${configFile} [port]`)
  } else {
    port = DEFAULT_PORT
  }

  const staticDirEnv = nonEmpty(env.KENZEN_STATIC_DIR)
  const staticDirRaw = staticDirEnv ?? asString(fileConfig.static_dir)
  if (staticDirRaw !== undefined) {
    requireAbsolute(
      staticDirRaw,
      staticDirEnv !== undefined ? "KENZEN_STATIC_DIR" : `${configFile} [static_dir]`,
    )
  }
  const staticDir = staticDirRaw ?? options.defaultStaticDir

  const stateDirEnv = nonEmpty(env.KENZEN_STATE_DIR)
  const stateDirRaw = stateDirEnv ?? asString(fileConfig.state_dir)
  if (stateDirRaw !== undefined) {
    requireAbsolute(
      stateDirRaw,
      stateDirEnv !== undefined ? "KENZEN_STATE_DIR" : `${configFile} [state_dir]`,
    )
  }
  const stateDir = stateDirRaw ?? DEFAULT_STATE_DIR
  const dbFile = `${stateDir.replace(/[\\/]+$/, "")}/kenzen.db`

  // Both-or-neither, and loud about it: a team domain with no audience (or vice versa) can
  // never produce a working verifier, and silently treating that as "Access unconfigured"
  // would look identical to a deliberately Access-less dev setup while actually being a typo
  // that quietly drops write-endpoint identity verification. Same standard as the rest of
  // this function -- fail loud beats failing silently wrong.
  const accessTeamDomain = nonEmpty(env.KENZEN_ACCESS_TEAM_DOMAIN)
  const accessAud = nonEmpty(env.KENZEN_ACCESS_AUD)
  if ((accessTeamDomain === undefined) !== (accessAud === undefined)) {
    throw new Error(
      "KENZEN_ACCESS_TEAM_DOMAIN and KENZEN_ACCESS_AUD must be set together -- only one is set",
    )
  }
  const devIdentity = nonEmpty(env.KENZEN_DEV_IDENTITY)

  return {
    host,
    port,
    configDir,
    configFile,
    staticDir,
    stateDir,
    dbFile,
    configSource,
    accessTeamDomain,
    accessAud,
    devIdentity,
  }
}

function parseConfigFile(text: string, configFile: string): Record<string, unknown> {
  try {
    return parseToml(text) as Record<string, unknown>
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`failed to parse ${configFile}: ${detail}`)
  }
}

/** Absolute on POSIX (`/x`) or Windows (`C:\x`, `\\unc`), so paths work cross-platform. */
function isAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\")
}

function requireAbsolute(p: string, label: string): void {
  if (!isAbsolute(p)) {
    throw new Error(`${label} must be an absolute path, got: ${p}`)
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

/** Undefined for null/undefined/empty-string, so a blank value falls through to the default. */
function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== "" ? value : undefined
}

/** Validate a port from either env (string) or config.toml (number), with a source-named error. */
function coercePort(value: unknown, label: string): number {
  const n =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`${label} must be an integer 1-65535, got: ${JSON.stringify(value)}`)
  }
  return n
}
