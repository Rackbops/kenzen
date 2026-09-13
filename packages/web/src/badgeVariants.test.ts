import { expect, test } from "vitest"
import {
  advisoryShieldVariant,
  advisoryVariant,
  advisoryVariantRank,
  gapShieldVariant,
} from "./badgeVariants.js"

/**
 * kenzen#90 round 1 review (HIGH): `gapShieldVariant`/`advisoryShieldVariant` were only ever
 * exercised indirectly through NeedsDecision.test.tsx, which never reaches `major`/`minor`
 * (NeedsDecision hardcodes "vulnerable" for its own advisory branch instead of calling
 * `advisoryShieldVariant` at all) -- Repos.tsx is the only caller that reaches those branches,
 * and its own test file asserts Badge text/links but never a shield. A swapped mapping there
 * shipped invisibly. These are direct, exhaustive unit tests of the pure functions -- every
 * real `ReportItem.gap`/`advisoryStatus` enum value (api.ts) against its expected variant.
 */

test("gapShieldVariant maps every real gap value", () => {
  expect(gapShieldVariant("major")).toBe("attention")
  expect(gapShieldVariant("minor")).toBe("attention")
  expect(gapShieldVariant("none")).toBe("healthy")
  expect(gapShieldVariant("patch")).toBeUndefined()
  expect(gapShieldVariant("unknown")).toBeUndefined()
  expect(gapShieldVariant(null)).toBeUndefined()
})

test("advisoryShieldVariant maps every real advisoryStatus value", () => {
  expect(advisoryShieldVariant("affected")).toBe("vulnerable")
  expect(advisoryShieldVariant("historical-only")).toBe("healthy")
  // Tooling#705: an unverified range floor must not be badged healthy or vulnerable either.
  expect(advisoryShieldVariant("range-floor")).toBeUndefined()
  expect(advisoryShieldVariant("none")).toBeUndefined()
  expect(advisoryShieldVariant("unknown")).toBeUndefined()
  expect(advisoryShieldVariant(null)).toBeUndefined()
})

test("advisoryVariant maps every real advisoryStatus value", () => {
  expect(advisoryVariant("affected")).toBe("danger")
  expect(advisoryVariant("historical-only")).toBe("warning")
  expect(advisoryVariant("range-floor")).toBe("info")
  expect(advisoryVariant("none")).toBe("success")
  expect(advisoryVariant("unknown")).toBeUndefined()
  expect(advisoryVariant(null)).toBeUndefined()
})

test("kenzen#113: advisoryVariantRank orders every real advisoryStatus value by severity", () => {
  expect(advisoryVariantRank("affected")).toBe(0)
  expect(advisoryVariantRank("historical-only")).toBe(1)
  expect(advisoryVariantRank("range-floor")).toBe(2)
  expect(advisoryVariantRank("none")).toBe(3)
  expect(advisoryVariantRank("unknown")).toBe(4)
  expect(advisoryVariantRank(null)).toBe(4)
})
