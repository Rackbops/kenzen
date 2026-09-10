import { expect, test } from "vitest"
import { advisoryShieldVariant, advisoryVariantRank, gapShieldVariant } from "./badgeVariants.js"

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
  expect(advisoryShieldVariant("none")).toBeUndefined()
  expect(advisoryShieldVariant("unknown")).toBeUndefined()
  expect(advisoryShieldVariant(null)).toBeUndefined()
})

test("kenzen#113: advisoryVariantRank orders every real advisoryStatus value by severity", () => {
  expect(advisoryVariantRank("affected")).toBe(0)
  expect(advisoryVariantRank("historical-only")).toBe(1)
  expect(advisoryVariantRank("none")).toBe(2)
  expect(advisoryVariantRank("unknown")).toBe(3)
  expect(advisoryVariantRank(null)).toBe(3)
})
