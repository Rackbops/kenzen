import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import { describe, expect, test } from "vitest"

/**
 * kenzen#89: smoke-tests the committed OUTPUT of `brand/derive.py` (run by hand -- Python/
 * Pillow isn't part of this repo's JS toolchain or CI, so this validates the checked-in PNGs
 * rather than re-running the derivation). Confirms each asset is the size it claims to be and
 * genuinely has a real alpha channel -- some fully transparent pixels (the removed
 * checkerboard) and some fully opaque ones (the fish itself) -- rather than e.g. a flat
 * all-transparent or all-opaque image, which would mean the cutout silently failed.
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

describe.each(ASSETS)("$file", ({ file, size }) => {
  test(`is exactly ${size}x${size}`, async () => {
    const meta = await sharp(path.join(BRAND_DIR, file)).metadata()
    expect(meta.width).toBe(size)
    expect(meta.height).toBe(size)
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
})
