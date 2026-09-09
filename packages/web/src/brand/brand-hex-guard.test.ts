import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

/** A favicon can't read CSS custom properties at all -- `public/favicon.svg` bakes the
 * light-theme values in as the drawing's colours, the one permitted exception to epic #88's
 * "no brand hex in packages/web" hard constraint (kenzen#89's own Scope). This file itself is
 * the other necessary exception: its own detection regex has to spell out the literal patterns
 * ("rgb(") it's searching for, which would otherwise flag itself. */
const ALLOWLIST = new Set([
  path.join(WEB_ROOT, "public", "favicon.svg"),
  fileURLToPath(import.meta.url),
])

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".svg"])

// A negative lookbehind for a word character or "&" keeps this from false-flagging an issue
// reference ("Tooling#425", exactly 3 hex-valid digits) or an HTML numeric entity ("&#9670;",
// also hex-valid digits) as a colour literal -- both bit this test during kenzen#89's own
// authoring. A real hex colour is always preceded by a quote, punctuation, or whitespace, never
// directly by a letter/digit/underscore or "&".
const HEX_OR_RGB = /(?<![\w&])#[0-9a-fA-F]{3,6}\b|rgb\(/

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(full))
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full)
    }
  }
  return files
}

test("kenzen#89: no literal brand hex (or rgb()) anywhere in packages/web except the favicon", () => {
  const offenders: { file: string; match: string }[] = []
  for (const dir of [path.join(WEB_ROOT, "src"), path.join(WEB_ROOT, "public")]) {
    for (const file of walk(dir)) {
      if (ALLOWLIST.has(file)) continue
      const content = readFileSync(file, "utf-8")
      const match = content.match(HEX_OR_RGB)
      if (match) {
        offenders.push({ file: path.relative(WEB_ROOT, file), match: match[0] })
      }
    }
  }
  expect(offenders).toEqual([])
})

test("kenzen#89: the allowlisted favicon actually exists and actually carries hex (the allowlist isn't guarding a typo'd path)", () => {
  const [faviconPath] = ALLOWLIST
  const content = readFileSync(faviconPath as string, "utf-8")
  expect(HEX_OR_RGB.test(content)).toBe(true)
})
