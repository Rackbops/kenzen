/**
 * kenzen#89: the Code Stream Koi mark (epic #88). roshne's direction, twice-revised: use
 * `brand/source/koi-teal.jpg` as-is, in its real colours -- not a hand-redrawn SVG
 * approximation, and not a recoloured mask either. `brand/derive.py` cuts the baked
 * checkerboard background out of the source (a real alpha channel, feathered edge) and
 * exports `packages/web/public/brand/koi-{512,192,64,32}.png` + `apple-touch-icon.png`; this
 * component is just an `<img>` onto the 64px asset, sized down as needed.
 *
 * Purely decorative next to the wordmark text, which already carries the "kenzen" name --
 * `alt=""` so a screen reader doesn't announce a redundant image.
 */
export interface KoiMarkProps {
  /** Rendered width/height in px. Default 24. */
  size?: number
}

export function KoiMark({ size = 24 }: KoiMarkProps) {
  return <img src="/brand/koi-64.png" width={size} height={size} alt="" className="kz-koi" />
}
