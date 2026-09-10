/**
 * kenzen#89: the Code Stream Koi mark (epic #88). roshne's direction, twice-revised: use
 * `brand/source/koi-teal.jpg` as-is, in its real colours -- not a hand-redrawn SVG
 * approximation, and not a recoloured mask either. `brand/derive.py` cuts the baked
 * checkerboard background out of the source (a real alpha channel, feathered edge) and
 * exports `packages/web/public/brand/koi-{512,192,64,32}.png` + `apple-touch-icon.png`.
 *
 * kenzen#112 amendment: `src`/width/height alone always resolve the 64px asset -- fine at
 * the header's original 40px, but a HiDPI display upscaling 64px art to the header's
 * enlarged 60 CSS px blurs the fish's circuit-board plates into a plain fish (roshne: "I
 * want people to clearly see the fish is cyber"). `srcset` lets the browser pick a sharper
 * source (192/512px) at the SAME rendered size once device-pixel density calls for it --
 * `sizes` tells it how many CSS px this image actually occupies so it can do that math.
 * `src`/width/height stay as the no-`srcset`-support fallback.
 *
 * Purely decorative next to the wordmark text, which already carries the "kenzen" name --
 * `alt=""` so a screen reader doesn't announce a redundant image.
 */
export interface KoiMarkProps {
  /** Rendered width/height in px. Default 24. */
  size?: number
}

export function KoiMark({ size = 24 }: KoiMarkProps) {
  return (
    <img
      src="/brand/koi-64.png"
      srcSet="/brand/koi-64.png 64w, /brand/koi-192.png 192w, /brand/koi-512.png 512w"
      sizes={`${size}px`}
      width={size}
      height={size}
      alt=""
      className="kz-koi"
    />
  )
}
