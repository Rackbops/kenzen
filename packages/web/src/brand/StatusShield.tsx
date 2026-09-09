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

export type StatusShieldVariant = "healthy" | "vulnerable" | "attention"

const SHIELD_SRC: Record<StatusShieldVariant, string> = {
  healthy: "/brand/shield-healthy-32.png",
  vulnerable: "/brand/shield-vulnerable-32.png",
  attention: "/brand/shield-attention-32.png",
}

export function StatusShield({
  variant,
  size = 14,
  title,
}: {
  variant: StatusShieldVariant
  size?: number
  title?: string
}) {
  return (
    <img src={SHIELD_SRC[variant]} width={size} height={size} alt={title ?? ""} title={title} />
  )
}
