import { expect, test } from "vitest"
import type { ItemDecision, ReportItem } from "./api.js"
import { decisionPriority, needsDecision } from "./needsDecision.js"

const NOW = "2026-09-08T00:00:00Z"

function item(overrides: Partial<ReportItem>): ReportItem {
  return {
    key: "k",
    repo: "Rackbops/Tooling",
    kind: "pip-dep",
    name: "requests",
    pinned: "2.31.0",
    pinStyle: "exact",
    role: "runtime",
    source: "requirements.txt:3",
    latest: "2.32.3",
    latestInMajor: "2.32.3",
    gap: "none",
    advisoryStatus: "none",
    advisories: [],
    assumed: null,
    note: null,
    decision: null,
    ...overrides,
  }
}

function decision(overrides: Partial<ItemDecision>): ItemDecision {
  return {
    skippedVersion: null,
    remindAt: null,
    approvedVersion: null,
    approvedFromPinned: null,
    acknowledgedAdvisories: null,
    updatedAt: NOW,
    updatedBy: "roshne",
    ...overrides,
  }
}

test("a sound, undecided item does not need a decision", () => {
  expect(needsDecision(item({ gap: "none", advisoryStatus: "none" }), NOW)).toBe(false)
})

test("an affected item needs a decision even with no gap", () => {
  expect(needsDecision(item({ gap: "none", advisoryStatus: "affected" }), NOW)).toBe(true)
})

test("a gapped item with no decision needs one", () => {
  for (const gap of ["major", "minor", "patch"] as const) {
    expect(needsDecision(item({ gap }), NOW)).toBe(true)
  }
})

test("an unknown-gap item never needs a decision on its own (no confirmed target to act on)", () => {
  expect(needsDecision(item({ gap: "unknown" }), NOW)).toBe(false)
})

test("a still-current skip suppresses -- the item no longer needs a decision", () => {
  const decided = item({
    gap: "minor",
    latest: "2.32.3",
    decision: decision({ skippedVersion: "2.32.3" }),
  })
  expect(needsDecision(decided, NOW)).toBe(false)
})

test("a skip superseded by a newer latest resurfaces -- needs a decision again", () => {
  const decided = item({
    gap: "minor",
    latest: "2.40.0",
    decision: decision({ skippedVersion: "2.32.3" }),
  })
  expect(needsDecision(decided, NOW)).toBe(true)
})

test("a remind not yet due suppresses", () => {
  const decided = item({ gap: "minor", decision: decision({ remindAt: "2026-12-01T00:00:00Z" }) })
  expect(needsDecision(decided, NOW)).toBe(false)
})

test("a remind whose date has passed resurfaces -- needs a decision again", () => {
  const decided = item({ gap: "minor", decision: decision({ remindAt: "2026-01-01T00:00:00Z" }) })
  expect(needsDecision(decided, NOW)).toBe(true)
})

test("an acknowledged advisory no longer needs a decision on that axis", () => {
  const decided = item({
    gap: "none",
    advisoryStatus: "affected",
    advisories: [
      {
        id: "GHSA-1",
        summary: "x",
        severity: "high",
        url: "https://x",
        source: "ghsa",
        affected: true,
      },
    ],
    decision: decision({ acknowledgedAdvisories: ["GHSA-1"] }),
  })
  expect(needsDecision(decided, NOW)).toBe(false)
})

test("decisionPriority ranks affected ahead of every gap severity", () => {
  const affected = item({ advisoryStatus: "affected", gap: "patch" })
  const major = item({ advisoryStatus: "none", gap: "major" })
  expect(decisionPriority(affected)).toBeLessThan(decisionPriority(major))
})

test("decisionPriority ranks gap severity major < minor < patch when not affected", () => {
  const major = decisionPriority(item({ gap: "major" }))
  const minor = decisionPriority(item({ gap: "minor" }))
  const patch = decisionPriority(item({ gap: "patch" }))
  expect(major).toBeLessThan(minor)
  expect(minor).toBeLessThan(patch)
})
