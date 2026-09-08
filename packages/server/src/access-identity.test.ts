import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose"
import { describe, expect, it } from "vitest"
import { createAccessJwtVerifier, normalizeTeamDomain } from "./access-identity.js"

const TEAM_DOMAIN = "example.cloudflareaccess.com"
const AUD = "test-aud"
const KID = "test-key-1"

// A real RSA keypair and a real local (no-network) JWKS, ported from rackbops-discord-bot's
// ops/admin/server.test.ts -- every test below exercises jose's actual signature/aud/iss/exp
// verification, not a mock of it.
const { publicKey, privateKey } = await generateKeyPair("RS256")
const jwk = await exportJWK(publicKey)
jwk.kid = KID
jwk.alg = "RS256"
const jwks = createLocalJWKSet({ keys: [jwk] })

// A second keypair/JWKS whose JWK omits `alg`, so createAccessJwtVerifier's explicit
// `algorithms: ["RS256"]` option is the only thing standing between an RS384-signed token and
// acceptance (with `alg` present, as `jwk` above has, jose's own key selection already narrows
// to RS256 regardless of that option, which would mask whether it does anything).
const { publicKey: unpinnedPublicKey, privateKey: unpinnedPrivateKey } =
  await generateKeyPair("RS384")
const unpinnedJwk = await exportJWK(unpinnedPublicKey)
const unpinnedJwks = createLocalJWKSet({ keys: [unpinnedJwk] })

interface TokenOverrides {
  iss?: string
  aud?: string
  omitSub?: boolean
  expiresInSeconds?: number
  email?: string
}

async function signToken(overrides: TokenOverrides = {}): Promise<string> {
  const {
    iss = `https://${TEAM_DOMAIN}`,
    aud = AUD,
    omitSub = false,
    expiresInSeconds = 3600,
    email,
  } = overrides
  let builder = new SignJWT(email !== undefined ? { email } : {})
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(iss)
    .setAudience(aud)
  if (!omitSub) builder = builder.setSubject("user@example.com")
  builder = builder.setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
  return builder.sign(privateKey)
}

function tamperSignature(jwt: string): string {
  const parts = jwt.split(".")
  const sig = parts[2] ?? ""
  const flippedChar = sig[0] === "A" ? "B" : "A"
  parts[2] = flippedChar + sig.slice(1)
  return parts.join(".")
}

describe("normalizeTeamDomain", () => {
  it("trims and lowercases a bare hostname", () => {
    expect(normalizeTeamDomain(` ${TEAM_DOMAIN.toUpperCase()} `)).toBe(TEAM_DOMAIN)
  })

  it("rejects a value carrying a scheme, port, or path", () => {
    expect(() => normalizeTeamDomain(`https://${TEAM_DOMAIN}`)).toThrow(/bare hostname/)
    expect(() => normalizeTeamDomain(`${TEAM_DOMAIN}:8443`)).toThrow(/bare hostname/)
    expect(() => normalizeTeamDomain(`${TEAM_DOMAIN}/cdn-cgi`)).toThrow(/bare hostname/)
  })
})

describe("createAccessJwtVerifier", () => {
  const verify = createAccessJwtVerifier(jwks, TEAM_DOMAIN, AUD)

  it("accepts a validly signed token with the right issuer/audience and returns its identity", async () => {
    const jwt = await signToken({ email: "user@example.com" })
    const identity = await verify(jwt)
    expect(identity).toEqual({
      sub: "user@example.com",
      email: "user@example.com",
      claims: expect.objectContaining({ sub: "user@example.com", email: "user@example.com" }),
    })
  })

  it("accepts a token with no email claim, surfacing sub with email undefined", async () => {
    const jwt = await signToken()
    const identity = await verify(jwt)
    expect(identity?.sub).toBe("user@example.com")
    expect(identity?.email).toBeUndefined()
  })

  it("rejects a tampered signature", async () => {
    const jwt = await signToken()
    expect(await verify(tamperSignature(jwt))).toBeNull()
  })

  it("rejects the wrong issuer", async () => {
    const jwt = await signToken({ iss: "https://someone-else.cloudflareaccess.com" })
    expect(await verify(jwt)).toBeNull()
  })

  it("rejects the wrong audience", async () => {
    const jwt = await signToken({ aud: "someone-elses-app" })
    expect(await verify(jwt)).toBeNull()
  })

  it("rejects an expired token", async () => {
    const jwt = await signToken({ expiresInSeconds: -10 })
    expect(await verify(jwt)).toBeNull()
  })

  it("rejects a token with no subject claim", async () => {
    const jwt = await signToken({ omitSub: true })
    expect(await verify(jwt)).toBeNull()
  })

  it("rejects garbage input", async () => {
    expect(await verify("not-a-jwt")).toBeNull()
  })

  it("pins RS256 -- a validly-signed RS384 token against a key with no alg to narrow it is rejected", async () => {
    const unpinnedVerify = createAccessJwtVerifier(unpinnedJwks, TEAM_DOMAIN, AUD)
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS384" })
      .setIssuedAt()
      .setIssuer(`https://${TEAM_DOMAIN}`)
      .setAudience(AUD)
      .setSubject("user@example.com")
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(unpinnedPrivateKey)
    expect(await unpinnedVerify(jwt)).toBeNull()
  })
})
