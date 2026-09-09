import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

/**
 * kenzen#88 (brand epic): every colour in packages/web/src goes through a --rb-* token, so
 * the twelve other themes keep rendering Kenzen correctly (STANDARD sections 12/15). A
 * literal hex or rgb()/rgba() bakes in one theme's colour regardless of which the viewer
 * picked -- exactly the class of bug the theme picker (kenzen#82) exists to make visible.
 * Static guard, in the style of app-css-details-guard.test.ts (kenzen#71): reads every
 * .ts/.tsx/.css/.svg file under src/ and public/ directly and greps for a real hex-color
 * token or an rgb(/rgba( call, rather than rendering anything.
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
 * Mutation: kenzen#90 pinned a literal hex fill in StatusShield.tsx and confirmed this fails,
 * naming the file and line.
 *
 * kenzen#89: `public/favicon.svg` bakes the light-theme hex in deliberately -- a favicon can't
 * read CSS custom properties at all. It's the one allowlisted exception, keyed by its path
 * relative to `SRC_DIR` (so it reads `../public/favicon.svg`, since `public/` is a sibling of
 * `src/`, not under it).
 */

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(SRC_DIR, "..", "public")
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".svg"])
const SELF = path.basename(fileURLToPath(import.meta.url))
const ALLOWLIST = new Set(["../public/favicon.svg"])

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

/** The offender list for a given set of root directories, applying `ALLOWLIST` by each file's
 * path relative to `SRC_DIR`. Pulled out of the main filesystem test so the allowlist's exact-
 * match behaviour can be exercised against a synthetic second file without depending on what
 * happens to exist in the real tree at test time. */
function findOffenders(roots: string[]): string[] {
  const offenders: string[] = []
  for (const root of roots) {
    for (const file of walk(root)) {
      const rel = path.relative(SRC_DIR, file).split(path.sep).join("/")
      if (ALLOWLIST.has(rel)) continue
      const lines = readFileSync(file, "utf-8").split("\n")
      lines.forEach((line, index) => {
        if (HEX_COLOR.test(line) || RGB_FUNCTION.test(line)) {
          offenders.push(`${rel}:${index + 1}: ${line.trim()}`)
        }
      })
    }
  }
  return offenders
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

test("no literal hex color or rgb()/rgba() call in packages/web/src or public -- use --rb-* tokens (except the allowlisted favicon)", () => {
  expect(findOffenders([SRC_DIR, PUBLIC_DIR])).toEqual([])
})

test("kenzen#89: the allowlisted favicon actually exists and actually carries hex (the allowlist isn't guarding a typo'd path)", () => {
  const faviconPath = path.join(PUBLIC_DIR, "favicon.svg")
  const content = readFileSync(faviconPath, "utf-8")
  expect(HEX_COLOR.test(content) || RGB_FUNCTION.test(content)).toBe(true)
})

test("kenzen#89: the allowlist is exact -- a second hex-bearing file next to the favicon still fails", () => {
  // A real second file, not a Set.has() unit check -- proves the allowlist doesn't broaden
  // into a directory-wide or prefix exemption for anything else placed in public/.
  const fixturePath = path.join(PUBLIC_DIR, "__brand-hex-guard-fixture.svg")
  writeFileSync(fixturePath, '<svg><rect fill="#123456" /></svg>\n')
  try {
    const offenders = findOffenders([SRC_DIR, PUBLIC_DIR])
    expect(offenders.some((o) => o.startsWith("../public/__brand-hex-guard-fixture.svg"))).toBe(
      true,
    )
  } finally {
    rmSync(fixturePath)
  }
})

test("kenzen#89: findOffenders scans a directory tree for real -- a smoke test against an isolated fixture dir", () => {
  // Belt-and-braces against the walk()/findOffenders() plumbing itself silently scanning
  // nothing (which would make every test above pass for the wrong reason): a genuinely
  // separate temp directory with one clean and one offending file.
  const dir = mkdtempSync(path.join(tmpdir(), "brand-hex-guard-"))
  try {
    writeFileSync(path.join(dir, "clean.css"), ".x { color: var(--rb-text); }\n")
    writeFileSync(path.join(dir, "dirty.css"), ".y { color: #abcdef; }\n")
    const offenders = findOffenders([dir])
    expect(offenders).toHaveLength(1)
    expect(offenders[0]).toContain("dirty.css")
  } finally {
    rmSync(dir, { recursive: true })
  }
})
