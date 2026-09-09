import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

/**
 * kenzen#88 (brand epic): every colour in packages/web/src goes through a --rb-* token, so
 * the twelve other themes keep rendering Kenzen correctly (STANDARD sections 12/15). A
 * literal hex or rgb()/rgba() bakes in one theme's colour regardless of which the viewer
 * picked -- exactly the class of bug the theme picker (kenzen#82) exists to make visible.
 * Static guard, in the style of app-css-details-guard.test.ts (kenzen#71): reads every
 * .ts/.tsx/.css file under src/ directly and greps for a real hex-color token or an rgb(/
 * rgba( call, rather than rendering anything.
 *
 * The three false-positive traps a naive `#[0-9a-f]{3,8}` catches immediately in THIS repo:
 *   - an issue reference like "kenzen#64" or "Tooling#425" -- "64"/"425" are themselves
 *     valid hex digits, and once an issue number reaches 3+ digits a bare digit-count check
 *     can't tell it apart from a real 3-digit hex color. Excluded by requiring the character
 *     immediately before `#` to be something other than a word character (a real CSS/JS hex
 *     literal is always preceded by whitespace, a quote, `:`, `(`, `,`, or start-of-line --
 *     never by a letter, digit or underscore, which is exactly what "kenzen" or "Tooling"
 *     ends in).
 *   - an HTML numeric entity like `&#9670;` (App.tsx's wordmark spark) -- "9670" is valid
 *     hex too. Excluded the same way: `&` is also barred from the lookbehind.
 *   - a bare URL fragment straight after a path slash, like `https://x/#336699` -- round 1
 *     review found this one: `/` is exactly as valid a predecessor of a real hex literal as
 *     whitespace/quote/`:`/`(`/`,`, so it joins the lookbehind's exclusion set too. (A `#`
 *     preceded by a letter, e.g. `.../palette#336699`, was already excluded by `\w`.)
 * A real hex color is additionally constrained to the lengths CSS actually accepts (3, 4, 6
 * or 8 digits, longest checked first so e.g. a 6-digit run isn't mistaken for two 3-digit
 * ones) with a trailing word boundary, so a longer incidental run of hex-valid characters
 * (a git sha fragment, say) can't partially match either.
 *
 * This file is excluded from its own scan (its doc comments and the regex source below both
 * necessarily contain `#` near hex-digit-class syntax that would otherwise self-trip it).
 *
 * Mutation: kenzen#90 originally pinned a literal hex fill in StatusShield.tsx (then a
 * hand-drawn inline SVG) and confirmed this fails, naming the file and line -- StatusShield
 * has since become a real-artwork `<img>` cutout with no colour literal of its own to pin
 * (kenzen#90's rework), so the same mutation was re-run against a literal hex temporarily
 * added to app.css instead, with the same result.
 */

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url))
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".css"])
const SELF = path.basename(fileURLToPath(import.meta.url))

// A real hex/rgb literal is never immediately preceded by a word character (letter/digit/_),
// `&` (an HTML entity marker), or `/` (a URL path) -- see the module doc comment above.
const HEX_COLOR = /(?<![\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/
// kenzen#90 round 1 review (MEDIUM): CSS's rgb()/rgba() are case-insensitive, and tools like
// Figma's inspector emit uppercase `RGB(...)` by default -- the original pattern missed it.
const RGB_FUNCTION = /\brgba?\(/i

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      files.push(...walk(full))
    } else if (SCAN_EXTENSIONS.has(path.extname(entry)) && entry !== SELF) {
      files.push(full)
    }
  }
  return files
}

test("RGB_FUNCTION matches rgb()/rgba() case-insensitively", () => {
  expect(RGB_FUNCTION.test("background: RGB(51, 102, 153);")).toBe(true)
  expect(RGB_FUNCTION.test("background: Rgba(0, 0, 0, .5);")).toBe(true)
  expect(RGB_FUNCTION.test("background: rgb(51, 102, 153);")).toBe(true)
})

test("HEX_COLOR does not false-positive on a bare URL fragment right after a path slash", () => {
  // A `#` immediately preceded by a letter (e.g. ".../palette#336699") was already excluded
  // by the word-char lookbehind -- the real gap is a fragment straight after "/", with
  // nothing word-like in between (e.g. a bare "https://x/#336699").
  expect(HEX_COLOR.test('href="https://example.com/#336699"')).toBe(false)
  expect(HEX_COLOR.test('href="/#abc123"')).toBe(false)
  // still catches a real literal right next to a legitimate boundary character
  expect(HEX_COLOR.test("color: #336699;")).toBe(true)
})

test("no literal hex color or rgb()/rgba() call in packages/web/src -- use --rb-* tokens", () => {
  const offenders: string[] = []
  for (const file of walk(SRC_DIR)) {
    const rel = path.relative(SRC_DIR, file)
    const lines = readFileSync(file, "utf-8").split("\n")
    lines.forEach((line, index) => {
      if (HEX_COLOR.test(line) || RGB_FUNCTION.test(line)) {
        offenders.push(`${rel}:${index + 1}: ${line.trim()}`)
      }
    })
  }
  expect(offenders).toEqual([])
})
