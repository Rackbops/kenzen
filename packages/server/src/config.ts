import {
  type ResolvedConfig as BaseResolvedConfig,
  type ResolveOptions as BaseResolveOptions,
  resolveConfig as resolveBaseConfig,
} from "@rackbops/node-app-kit/config"

/**
 * Kenzen's own config: the shared base (host/port/dirs/dbFile, precedence `KENZEN_*` env >
 * `config.toml` > defaults) comes from `@rackbops/node-app-kit`, extended with the fields that
 * have no shared-package home -- Cloudflare Access identity and the local-dev identity stand-in
 * (see `@rackbops/node-app-kit`'s own `config.ts` doc-comment for why those stay app-specific).
 * This is the "thin app-specific wrapper" the extraction plan (`Tooling#511`) called for: no
 * behaviour change from Kenzen's pre-extraction `config.ts`, just its generic 80% now delegated
 * rather than duplicated.
 */

export interface KenzenConfig extends BaseResolvedConfig {
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

export type ResolveOptions = Omit<BaseResolveOptions, "prefix">

export function resolveConfig(
  env: Record<string, string | undefined>,
  options: ResolveOptions,
): KenzenConfig {
  const base = resolveBaseConfig(env, { ...options, prefix: "KENZEN" })

  // Both-or-neither, and loud about it: a team domain with no audience (or vice versa) can
  // never produce a working verifier, and silently treating that as "Access unconfigured"
  // would look identical to a deliberately Access-less dev setup while actually being a typo
  // that quietly drops write-endpoint identity verification. Same standard the shared base
  // applies to its own fields -- fail loud beats failing silently wrong.
  const accessTeamDomain = nonEmpty(env.KENZEN_ACCESS_TEAM_DOMAIN)
  const accessAud = nonEmpty(env.KENZEN_ACCESS_AUD)
  if ((accessTeamDomain === undefined) !== (accessAud === undefined)) {
    throw new Error(
      "KENZEN_ACCESS_TEAM_DOMAIN and KENZEN_ACCESS_AUD must be set together -- only one is set",
    )
  }
  const devIdentity = nonEmpty(env.KENZEN_DEV_IDENTITY)

  return { ...base, accessTeamDomain, accessAud, devIdentity }
}

/** Undefined for null/undefined/empty-string, so a blank value falls through to unset -- same
 * rule the shared base module applies to every one of its own fields. */
function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== "" ? value : undefined
}
