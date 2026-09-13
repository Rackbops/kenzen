import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

// Comments stripped first -- this file's own doc comments quote example selectors/declarations
// (including "{display:none}") that would otherwise be mistaken for real rules by the naive
// brace-splitting parser below.
const APP_CSS = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "app.css"),
  "utf-8",
).replace(/\/\*[\s\S]*?\*\//g, "")

/**
 * kenzen#64 round 2, live-reproduced twice (`.kz-menu__panel`, then `.kz-advisories__list`): a
 * closed `<details>`'s non-summary content is hidden only by a USER-AGENT stylesheet rule
 * (`details:not([open]) > *:not(summary){display:none}`), and author-origin CSS always wins
 * over user-agent-origin CSS regardless of selector specificity -- so an unconditional `display:`
 * on a details' child class defeats that native hiding and leaves it permanently laid out. jsdom
 * implements neither the UA rule nor real CSS cascade origin, so no render-based test can catch
 * this; only a live browser probe or a static read of the source can.
 *
 * For each known details/child pair: the bare child selector (`.foo`) must NOT itself carry a
 * `display:` declaration, and a `[open]`-guarded selector (`.details[open] .foo` or
 * `.details[open] > .foo`) MUST exist and DOES carry one. Mutation: un-guard either half and
 * this fails.
 */
const DETAILS_CHILD_PAIRS = [
  { detailsClass: "kz-menu", childClass: "kz-menu__panel" },
  { detailsClass: "kz-advisories", childClass: "kz-advisories__list" },
] as const

interface Rule {
  selector: string
  body: string
}

function parseRules(): Rule[] {
  // Crude but sufficient: app.css has no nested rules/at-rules with braces inside a selector,
  // so splitting on "}" and slicing each block at its own "{" recovers every rule's selector
  // and body.
  const rules: Rule[] = []
  for (const block of APP_CSS.split("}")) {
    const braceIndex = block.indexOf("{")
    if (braceIndex === -1) continue
    rules.push({ selector: block.slice(0, braceIndex), body: block.slice(braceIndex + 1) })
  }
  return rules
}

for (const { detailsClass, childClass } of DETAILS_CHILD_PAIRS) {
  test(`.${childClass}'s bare selector carries no unconditional display, and a [open]-guarded rule sets it`, () => {
    const childToken = new RegExp(`(?<![\\w-])\\.${childClass}(?![\\w-])`)
    const guardToken = new RegExp(`\\.${detailsClass}\\[open\\]`)

    const matching = parseRules().filter((r) => childToken.test(r.selector))
    expect(matching.length).toBeGreaterThan(0)

    const bare = matching.filter((r) => !guardToken.test(r.selector))
    const guarded = matching.filter((r) => guardToken.test(r.selector))

    for (const rule of bare) {
      expect(rule.body).not.toMatch(/display\s*:/)
    }
    expect(guarded.length).toBeGreaterThan(0)
    expect(guarded.some((r) => /display\s*:/.test(r.body))).toBe(true)
  })
}

/**
 * kenzen#126: jsdom can't compute `color-mix()`, so this is a source-reading guard, in the same
 * style as the pairs above -- for each semantic variant, `.kz-items-table .rb-badge--<v>` must
 * exist with `color: var(--rb-bg)` (the page itself as ink) and a `color-mix(in srgb,
 * var(--rb-<v>) 40%, var(--rb-text))` fill (the semantic colour mixed toward the theme's own
 * text colour -- pastel on a dark theme, deep on a light one). Contrast of the accent colour AS
 * TEXT on the library's own 16% tint measured as low as 1.3:1 (cyberhealth success); this
 * formula measures >= 5.4:1 on every bundled theme (rackbops-ui-ux-std-lib#207's own table).
 */
const BADGE_VARIANTS = ["info", "success", "warning", "danger"] as const

for (const variant of BADGE_VARIANTS) {
  test(`.kz-items-table .rb-badge--${variant} inverts its fill against the theme (kenzen#126)`, () => {
    const selectorToken = new RegExp(
      `(?<![\\w-])\\.kz-items-table \\.rb-badge--${variant}(?![\\w-])`,
    )
    const matching = parseRules().filter((r) => selectorToken.test(r.selector))
    expect(matching.length).toBeGreaterThan(0)

    const mixToken = new RegExp(
      `color-mix\\(in srgb,\\s*var\\(--rb-${variant}\\)\\s*40%,\\s*var\\(--rb-text\\)\\)`,
    )
    expect(matching.some((r) => /color\s*:\s*var\(--rb-bg\)/.test(r.body))).toBe(true)
    expect(matching.some((r) => mixToken.test(r.body))).toBe(true)
  })
}
