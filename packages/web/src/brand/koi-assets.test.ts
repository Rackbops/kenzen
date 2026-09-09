import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import { describe, expect, test } from "vitest"

/**
 * kenzen#89 (+ kenzen#92's banner): smoke-tests the committed OUTPUT of `brand/derive.py` (run
 * by hand -- Python/Pillow isn't part of this repo's JS toolchain or CI, so this validates the
 * checked-in PNGs rather than re-running the derivation). Confirms each asset is the size it
 * claims to be.
 *
 * The four transparent koi exports additionally get a real-alpha check: some fully transparent
 * pixels (the removed checkerboard) and some fully opaque ones (the fish itself), rather than
 * e.g. a flat all-transparent or all-opaque image, which would mean the cutout silently
 * failed. `apple-touch-icon.png` is excluded from that check on purpose -- Apple's own HIG
 * says a touch icon shouldn't carry transparency (iOS can render the empty area black instead
 * of compositing it), so `derive.py` flattens that one target onto a solid navy background and
 * ships it with no alpha channel at all.
 *
 * `koi-banner.png`/`.webp` (kenzen#92) get their own block below -- 1024x395 (cropped to
 * content + margin, not square), so they don't fit the `ASSETS`/`describe.each` shape above,
 * but the same real-alpha check applies (the checkerboard removed correctly, not silently
 * flattened to fully one alpha value in either direction).
 */
const BRAND_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
  "brand",
)

const ASSETS = [
  { file: "koi-512.png", size: 512 },
  { file: "koi-192.png", size: 192 },
  { file: "koi-64.png", size: 64 },
  { file: "koi-32.png", size: 32 },
  { file: "apple-touch-icon.png", size: 180 },
]

const TRANSPARENT_ASSETS = ASSETS.filter((a) => a.file !== "apple-touch-icon.png")

describe.each(ASSETS)("$file", ({ file, size }) => {
  test(`is exactly ${size}x${size}`, async () => {
    const meta = await sharp(path.join(BRAND_DIR, file)).metadata()
    expect(meta.width).toBe(size)
    expect(meta.height).toBe(size)
  })
})

describe.each(TRANSPARENT_ASSETS)("$file", ({ file }) => {
  test("has a real alpha channel: some fully transparent pixels and some fully opaque ones", async () => {
    const { data, info } = await sharp(path.join(BRAND_DIR, file))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(4)
    let sawTransparent = false
    let sawOpaque = false
    for (let i = 3; i < data.length; i += 4) {
      const alpha = data[i]
      if (alpha === 0) sawTransparent = true
      if (alpha === 255) sawOpaque = true
      if (sawTransparent && sawOpaque) break
    }
    expect(sawTransparent).toBe(true)
    expect(sawOpaque).toBe(true)
  })
})

test("apple-touch-icon.png deliberately carries no alpha channel at all", async () => {
  const meta = await sharp(path.join(BRAND_DIR, "apple-touch-icon.png")).metadata()
  expect(meta.hasAlpha).toBe(false)
})

describe.each(["koi-banner.png", "koi-banner.webp"])("%s", (file) => {
  test("is exactly 1024x395 -- content bounding box plus derive.py's CROP_MARGIN", async () => {
    const meta = await sharp(path.join(BRAND_DIR, file)).metadata()
    expect(meta.width).toBe(1024)
    expect(meta.height).toBe(395)
  })

  test("has a real alpha channel: some fully transparent pixels and some fully opaque ones", async () => {
    const { data, info } = await sharp(path.join(BRAND_DIR, file))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(4)
    let sawTransparent = false
    let sawOpaque = false
    for (let i = 3; i < data.length; i += 4) {
      const alpha = data[i]
      if (alpha === 0) sawTransparent = true
      if (alpha === 255) sawOpaque = true
      if (sawTransparent && sawOpaque) break
    }
    expect(sawTransparent).toBe(true)
    expect(sawOpaque).toBe(true)
  })

  test("the opaque fraction is in the range real art produces, not just a sliver of forced-dark outline", async () => {
    // kenzen#92 round 3 review (originally against a since-superseded recipe, re-verified
    // here against the current light-checker one): derive_banner()'s `inside_outline` step
    // forces the koi's own dark-outline-fenced pixels opaque regardless of the colour-to-alpha
    // thresholds, so a badly broken threshold can still leave a few opaque pixels and the
    // plain "some opaque" check above can't tell that apart from a correct cutout. Measured
    // directly against this recipe's real constants (all fractions over the actual cropped
    // 1024x395 output, same as the committed asset):
    //   - correct (real constants):            14.6% opaque
    //   - DARK_LUM=-1 (no outline protection):   7.9% opaque
    //   - C2A_OPAQUE=0.99 (opacity near-unreachable via colour-to-alpha alone):  10.3% opaque
    //   - BG_LUM_MIN=999 (background never detected):                          100.0% opaque
    //   - C2A_TRANSPARENT=0.5 (at/above the opacity threshold, degenerate):      98.4% opaque
    // A floor above the two ~8-10% breaks and a ceiling well under the two ~98-100% breaks
    // catches both directions without being brittle to small legitimate re-tunes.
    const { data } = await sharp(path.join(BRAND_DIR, file))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    let opaque = 0
    let totalPixels = 0
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 255) opaque++
      totalPixels++
    }
    const fraction = opaque / totalPixels
    expect(fraction).toBeGreaterThan(0.115)
    expect(fraction).toBeLessThan(0.3)
  })
})
