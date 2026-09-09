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
 * The two false-positive traps a naive `#[0-9a-f]{3,8}` catches immediately in THIS repo:
 *   - an issue reference like "kenzen#64" or "Tooling#425" -- "64"/"425" are themselves
 *     valid hex digits, and once an issue number reaches 3+ digits a bare digit-count check
 *     can't tell it apart from a real 3-digit hex color. Excluded by requiring the character
 *     immediately before `#` to be something other than a word character (a real CSS/JS hex
 *     literal is always preceded by whitespace, a quote, `:`, `(`, `,`, or start-of-line --
 *     never by a letter, digit or underscore, which is exactly what "kenzen" or "Tooling"
 *     ends in).
 *   - an HTML numeric entity like `&#9670;` (App.tsx's wordmark spark) -- "9670" is valid
 *     hex too. Excluded the same way: `&` is also barred from the lookbehind.
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
 */

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url))
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".css"])
const SELF = path.basename(fileURLToPath(import.meta.url))

// A real hex/rgb literal is never immediately preceded by a word character (letter/digit/_)
// or `&` (an HTML entity marker) -- see the module doc comment above for why both matter here.
const HEX_COLOR = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/
const RGB_FUNCTION = /\brgba?\(/

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
