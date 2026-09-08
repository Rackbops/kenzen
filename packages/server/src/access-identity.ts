import type { JWTVerifyGetKey } from "jose"
import { jwtVerify } from "jose"

/**
 * Verified Cloudflare Access identity, ported from `rackbops-discord-bot`'s
 * `ops/admin/server.ts` (`AccessIdentity`/`createAccessJwtVerifier`/`normalizeTeamDomain`) --
 * the exact reference design.md section 11 cites ("verified against the team's certs as the
 * bot's admin panel does"). K4-5 needs its own copy: `updatedBy` on a decision is only a
 * trustworthy audit-trail entry if the identity behind it is actually verified, and that
 * verification is a handful of well-tested lines already proven against real Access tokens --
 * reuse, not new design, so it belongs in this PR rather than a deferred follow-up.
 */
export interface AccessIdentity {
  sub: string
  email: string | undefined
  claims: Record<string, unknown>
}

/** Verifies a raw JWT string, or returns null on any failure (bad signature, expired, wrong
 * aud/iss, JWKS unreachable) -- callers never need their own try/catch around it. */
export type VerifyAccessJwt = (jwt: string) => Promise<AccessIdentity | null>

/** The header Cloudflare Access injects on every request once it's gating a route. Hono's own
 * `c.req.header()` already covers reading it -- this is just the one place the literal name is
 * spelled, so a typo can't silently diverge between the route and its tests. */
export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion"

/**
 * Trims/lowercases a raw `KENZEN_ACCESS_TEAM_DOMAIN` value and rejects anything that isn't a
 * bare hostname (a pasted `https://` prefix, a port, a path) -- `new URL(...)` alone would
 * silently accept those as a garbage host. Lowercasing matters because jose's issuer
 * comparison is case-sensitive even though DNS hostnames aren't, and this same value is used
 * for both the JWKS URL and the issuer check.
 */
export function normalizeTeamDomain(raw: string): string {
  const teamDomain = raw.trim().toLowerCase()
  const jwksUrl = new URL(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (jwksUrl.hostname !== teamDomain) {
    throw new Error(
      `KENZEN_ACCESS_TEAM_DOMAIN doesn't look like a bare hostname (parsed as "${jwksUrl.hostname}") -- omit any scheme, port, or path`,
    )
  }
  return teamDomain
}

/**
 * Factored apart from its caller so tests can exercise the real jose verification call
 * (signature/aud/iss/exp checks included) against a local, no-network JWKS -- `jwks` accepts
 * either `createRemoteJWKSet`'s or `createLocalJWKSet`'s return value, same shape.
 */
export function createAccessJwtVerifier(
  jwks: JWTVerifyGetKey,
  teamDomain: string,
  aud: string,
): VerifyAccessJwt {
  return async (jwt: string): Promise<AccessIdentity | null> => {
    try {
      const { payload } = await jwtVerify(jwt, jwks, {
        issuer: `https://${teamDomain}`,
        audience: aud,
        // Pinned explicitly, not left to jose's default inference -- guards against an
        // algorithm-confusion attack if a future key were ever served under an unexpected alg.
        algorithms: ["RS256"],
      })
      return typeof payload.sub === "string"
        ? {
            sub: payload.sub,
            email: typeof payload.email === "string" ? payload.email : undefined,
            claims: { ...payload },
          }
        : null
    } catch {
      return null
    }
  }
}
