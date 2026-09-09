import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

// kenzen#89: renders the favicon set from public/favicon.svg (the one file in packages/web
// allowed literal brand hex, since a favicon can't read CSS custom properties). Run via
// `pnpm --filter web icons`; the PNGs it writes are committed, not built at deploy time -- the
// same "commit the derived asset" call as the theme's own bundled CSS, so `vite build` never
// needs sharp/resvg as a runtime dependency.

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url))
const SVG_PATH = fileURLToPath(new URL("../public/favicon.svg", import.meta.url))

const TARGETS = [
  { file: "favicon-32.png", size: 32 },
  { file: "apple-touch-icon.png", size: 180 },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
]

async function main() {
  const svg = readFileSync(SVG_PATH)
  for (const { file, size } of TARGETS) {
    const outPath = `${PUBLIC_DIR}/${file}`
    await sharp(svg, { density: (size / 64) * 96 })
      .resize(size, size)
      .png()
      .toFile(outPath)
    console.log(`wrote ${file} (${size}x${size})`)
  }
}

await main()
