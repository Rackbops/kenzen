/**
 * kenzen#90 (brand epic #88): the status glyph for the Gap and Advisory badges. roshne's
 * direction for the whole brand epic, reopened after this was first shipped as a hand-drawn
 * inline SVG (kenzen#97): use the real artwork as-is. `brand/derive.py` (shared with kenzen#89's
 * `KoiMark`) cuts the baked checkerboard out of `brand/source/status-shields.jpg` -- sliced
 * into its three thirds first, left to right: mint check = healthy, crimson bug = vulnerable,
 * amber exclamation = attention -- and exports `packages/web/public/brand/shield-{variant}-
 * {64,32}.png`. This component is just an `<img>` onto each variant's 32px asset, sized down
 * as needed; the shield's inner ring is genuine transparency in the source art (not a colour
 * this component controls), so it already shows whatever sits behind the image.
 *
 * kenzen#128: the shield's navy body vanishes into kenzen-midnight's own navy page (only a
 * thin outline sliver and the glyph stayed visible -- roshne's screenshot). `derive.py` gained
 * `derive_shield_light_variants()`, re-toning the SAME source cutout's body to the brand's
 * light silver from the same source pixels (no redraw); roshne's pick from the review sheet
 * (2026-09-13) was **(b) silver body, glyph colours kept, 24px** -- the ONE sanctioned re-tone
 * of this brand art (every other derived asset stays exactly the source's own colours). On a
 * dark-scheme theme (`useScheme()`, provided by `App.tsx` from its own theme state) this
 * renders `shield-<variant>-ondark-32.png` instead of the original, with a `srcSet` to the
 * matching `-64.png` for a crisp 2x render; a light-scheme theme (or no `SchemeContext`
 * provider at all -- every route-level test in this repo renders a route component directly,
 * not through `<App>`) keeps today's unchanged navy artwork.
 *
 * Unlike `KoiMark` (always decorative, no accessible name), every real call site here
 * (`badgeVariants.ts`'s wiring in `NeedsDecision.tsx`/`Repos.tsx`) renders this WITHOUT a
 * `title` -- the glyph sits beside a text `Badge` that already carries the status in words
 * (STANDARD: status is never colour-only), so the image stays decorative (`alt=""`) there.
 * The optional `title` prop exists for a future or test-only labeled usage: set, it becomes
 * the image's accessible name (`alt`) and hover tooltip (`title`); omitted, `alt=""` is the
 * standard HTML way to mark a decorative image invisible to assistive tech -- the same
 * behavioural contract the previous inline-SVG version expressed via `role`/`aria-hidden`,
 * adapted to the idiomatic `<img>` mechanism instead of carried over attribute-for-attribute.
 */

import { useScheme } from "../scheme.js"

export type StatusShieldVariant = "healthy" | "vulnerable" | "attention"

const SHIELD_SRC: Record<StatusShieldVariant, string> = {
  healthy: "/brand/shield-healthy-32.png",
  vulnerable: "/brand/shield-vulnerable-32.png",
  attention: "/brand/shield-attention-32.png",
}

const SHIELD_SRC_ONDARK: Record<StatusShieldVariant, string> = {
  healthy: "/brand/shield-healthy-ondark-32.png",
  vulnerable: "/brand/shield-vulnerable-ondark-32.png",
  attention: "/brand/shield-attention-ondark-32.png",
}

const SHIELD_SRCSET_2X: Record<StatusShieldVariant, string> = {
  healthy: "/brand/shield-healthy-64.png 2x",
  vulnerable: "/brand/shield-vulnerable-64.png 2x",
  attention: "/brand/shield-attention-64.png 2x",
}

const SHIELD_SRCSET_2X_ONDARK: Record<StatusShieldVariant, string> = {
  healthy: "/brand/shield-healthy-ondark-64.png 2x",
  vulnerable: "/brand/shield-vulnerable-ondark-64.png 2x",
  attention: "/brand/shield-attention-ondark-64.png 2x",
}

export function StatusShield({
  variant,
  size = 24,
  title,
}: {
  variant: StatusShieldVariant
  size?: number
  title?: string
}) {
  const dark = useScheme() === "dark"
  const src = dark ? SHIELD_SRC_ONDARK[variant] : SHIELD_SRC[variant]
  const srcSet = dark ? SHIELD_SRCSET_2X_ONDARK[variant] : SHIELD_SRCSET_2X[variant]
  return (
    <img src={src} srcSet={srcSet} width={size} height={size} alt={title ?? ""} title={title} />
  )
}
