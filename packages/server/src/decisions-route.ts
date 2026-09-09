import type { DatabaseSync } from "node:sqlite"
import type { Logger } from "@rackbops/node-app-kit/log"
import type { Context, Hono } from "hono"
import type { VerifyAccessJwt } from "./access-identity.js"
import { ACCESS_JWT_HEADER } from "./access-identity.js"
import type { DecisionPatch, DecisionRow } from "./decisions.js"
import { listDecisions, putDecision } from "./decisions.js"

export const API_VERSION = 1

export interface MountDecisionsOptions {
  db: DatabaseSync
  log: Logger
  /** Absent when Access isn't configured for this instance (no KENZEN_ACCESS_TEAM_DOMAIN/AUD)
   * -- a JWT header is then never evaluated at all, closing any accidental-trust gap rather
   * than pretending to verify. */
  verifyAccessJwt?: VerifyAccessJwt
  /** design.md section 11 / plan.md K4-5: a local-dev stand-in, refused whenever a JWT is
   * present so a real Access identity always takes precedence over it. */
  devIdentity?: string
}

function errorBody(error: string): Record<string, unknown> {
  return { apiVersion: API_VERSION, error }
}

function decisionJson(decision: DecisionRow): Record<string, unknown> {
  const body: Record<string, unknown> = {
    key: decision.key,
    repo: decision.repo,
    name: decision.name,
    updatedAt: decision.updatedAt,
    updatedBy: decision.updatedBy,
  }
  if (decision.kind !== null) body.kind = decision.kind
  if (decision.source !== null) body.source = decision.source
  if (decision.skippedVersion !== null) body.skippedVersion = decision.skippedVersion
  if (decision.remindAt !== null) body.remindAt = decision.remindAt
  if (decision.approvedVersion !== null) {
    body.approvedVersion = decision.approvedVersion
    // K4-9 round 2, HIGH: the client needs this to compute suppressionState's approvedVersion
    // branch itself ("suppressed until pinned moves or latest passes the approved version") --
    // omitting it (as "internal bookkeeping" this field was originally, before there was a
    // client-side suppression consumer) left the approve-axis's resurface-on-pinned-move path
    // permanently unreachable: the client's verdict could never see the PR-merged case at all.
    if (decision.approvedFromPinned !== null) body.approvedFromPinned = decision.approvedFromPinned
  }
  if (decision.acknowledgedAdvisories !== null) {
    body.acknowledgedAdvisories = decision.acknowledgedAdvisories
  }
  return body
}

/**
 * Resolves the identity to record as `updatedBy`. A `Cf-Access-Jwt-Assertion` header always
 * takes precedence when present -- verified via the injected `verifyAccessJwt`, never trusted
 * unverified, and never overridden by `devIdentity` even if that's also set (design.md
 * section 11 / plan.md K4-5: "refused when a JWT is present"). No header falls back to
 * `devIdentity`. Every path can end in "no identity" (`null`), which the caller turns into a
 * 401 -- a write with no attributable identity is never allowed through.
 *
 * kenzen#57: a verified Access **service token** identity is rejected outright
 * (`identity.isServiceToken`), and so is any identity whose `email || sub` still resolves to
 * empty/whitespace after that check -- decisions are a human-only write path, and a service
 * token's `sub: ""` + absent `email` previously slipped past the old `=== null` guard (a string,
 * just an empty one) and got recorded as `updatedBy: ""`. Both rejections log a reason, never
 * the token itself.
 */
async function resolveUpdatedBy(
  c: Context,
  options: MountDecisionsOptions,
): Promise<string | null> {
  const jwt = c.req.header(ACCESS_JWT_HEADER)
  if (jwt !== undefined) {
    if (!options.verifyAccessJwt) {
      return null
    }
    const identity = await options.verifyAccessJwt(jwt)
    if (!identity) {
      return null
    }
    if (identity.isServiceToken) {
      options.log.warn("decision rejected: no attributable identity", { reason: "service token" })
      return null
    }
    // `||`, not `??`: a token carrying a literal empty-string email claim (not expected from
    // real Cloudflare Access, but not ruled out by the type) must fall back to sub the same
    // way an absent claim does, rather than recording updatedBy as "" (Tooling#478 K4-5
    // review round 1, LOW).
    const updatedBy = identity.email || identity.sub
    if (updatedBy.trim() === "") {
      options.log.warn("decision rejected: no attributable identity", { reason: "empty claims" })
      return null
    }
    return updatedBy
  }
  return options.devIdentity ?? null
}

const PATCH_FIELDS = [
  "skippedVersion",
  "remindAt",
  "approvedVersion",
  "acknowledgedAdvisories",
  "clear",
] as const

function parsePatchBody(body: unknown): DecisionPatch | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "body must be a JSON object" }
  }
  const record = body as Record<string, unknown>
  const present = PATCH_FIELDS.filter((k) => k in record)
  if (present.length !== 1) {
    return {
      error: `body must set exactly one of ${PATCH_FIELDS.join(", ")}, got: ${
        present.length === 0 ? "none" : present.join(", ")
      }`,
    }
  }
  const field = present[0] as (typeof PATCH_FIELDS)[number]
  const value = record[field]
  switch (field) {
    case "skippedVersion":
    case "remindAt":
    case "approvedVersion":
      return typeof value === "string" && value !== ""
        ? { field, value }
        : { error: `${field} must be a non-empty string` }
    case "acknowledgedAdvisories":
      return Array.isArray(value) && value.every((v) => typeof v === "string")
        ? { field, value: value as string[] }
        : { error: "acknowledgedAdvisories must be an array of strings" }
    case "clear":
      return value === true ? { field: "clear" } : { error: "clear must be true" }
  }
}

/**
 * `GET /api/decisions` and `PUT /api/decisions/:key`, design.md sections 4.3 and 5. The `:key`
 * path segment is `repo|kind|name|source` (e.g.
 * `Rackbops/kenzen|npm-dep|hono|package.json:12`), which contains characters a raw path
 * segment can't -- the client must `encodeURIComponent` it, decoded back here with
 * `decodeURIComponent`.
 */
export function mountDecisionsRoute(app: Hono, options: MountDecisionsOptions): void {
  app.get("/api/decisions", (c: Context) => {
    const decisions = listDecisions(options.db).map(decisionJson)
    return c.json({ apiVersion: API_VERSION, decisions })
  })

  app.put("/api/decisions/:key", async (c: Context) => {
    const updatedBy = await resolveUpdatedBy(c, options)
    if (updatedBy === null) {
      return c.json(errorBody("unauthorized"), 401)
    }

    const rawKey = c.req.param("key")
    if (rawKey === undefined) {
      return c.json(errorBody("missing key"), 400)
    }
    const key = decodeURIComponent(rawKey)

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(errorBody("body must be valid JSON"), 422)
    }
    const patch = parsePatchBody(body)
    if ("error" in patch) {
      return c.json(errorBody(patch.error), 422)
    }

    const result = putDecision(options.db, key, patch, updatedBy, new Date().toISOString())
    if (!result.ok) {
      options.log.warn("decision rejected", { key, error: result.error })
      return c.json(errorBody(result.error), result.status)
    }

    options.log.info("decision updated", { key, field: patch.field, updatedBy })
    return c.json(
      { apiVersion: API_VERSION, decision: result.decision ? decisionJson(result.decision) : null },
      200,
    )
  })
}
