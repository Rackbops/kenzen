/**
 * kenzen#90 (brand epic #88): the status glyph for the Gap and Advisory badges, traced from
 * `brand/source/status-shields.jpg` (mint check = healthy, crimson bug = vulnerable, amber
 * exclamation = attention). Same shield OUTLINE across all three variants -- only the inner
 * glyph and its colour change -- so a row of mixed statuses lines up. Tokens only: the shield
 * body is `var(--rb-text)` with an inset outline in `var(--rb-bg)` (as in the source's
 * navy-on-light-border look), and the glyph is `var(--rb-success)` / `var(--rb-danger)` /
 * `var(--rb-warning)`, matching the three semantic Badge variants it sits beside. Every glyph
 * is drawn with `stroke` and `stroke-linecap: round` only -- including the checkmark's and
 * exclamation's "dots" (a zero-length round-capped stroke renders as a filled circle without
 * ever setting `fill` to anything but `none`) -- so nothing here needs a fill colour beyond
 * the shield body itself.
 *
 * Props and the title/aria-hidden contract match KoiMark (kenzen#89): `title` renders a
 * `<title>` and `role="img"`; omitted, the SVG is `aria-hidden`. `size` defaults to 14 --
 * small enough to sit inline before a Badge's text without competing with it.
 */

export type StatusShieldVariant = "healthy" | "vulnerable" | "attention"

const GLYPH_TOKEN: Record<StatusShieldVariant, string> = {
  healthy: "var(--rb-success)",
  vulnerable: "var(--rb-danger)",
  attention: "var(--rb-warning)",
}

// One shield outline, reused for the outer (filled) body and, scaled down from center, for
// the inset inner border -- so both are guaranteed to be the same shape, never two paths that
// could drift apart under a future edit.
const SHIELD_PATH =
  "M12 1.4 L4.6 4.1 V10.6 C4.6 16.2 7.8 20.5 12 22 C16.2 20.5 19.4 16.2 19.4 10.6 V4.1 Z"

function ShieldGlyph({ variant }: { variant: StatusShieldVariant }) {
  const glyph = GLYPH_TOKEN[variant]
  switch (variant) {
    case "healthy":
      // Two strokes, as the source draws it -- not one continuous polyline.
      return (
        <g stroke={glyph} strokeWidth="2.1" strokeLinecap="round" fill="none">
          <path d="M7.8 12.1 L10.6 15" />
          <path d="M10.6 15 L16.3 8.2" />
        </g>
      )
    case "vulnerable":
      // A six-leg outline: antennae, a round-stroke "filled" head dot, an oval body with a
      // spine line, three legs per side.
      return (
        <g stroke={glyph} strokeWidth="1.3" strokeLinecap="round" fill="none">
          <path d="M10.6 7.4 L9.2 5.6" />
          <path d="M13.4 7.4 L14.8 5.6" />
          <path d="M12 8.4 L12 8.4" strokeWidth="3" />
          <rect x="9" y="9.6" width="6" height="7" rx="3" />
          <path d="M12 9.6 V16.6" />
          <path d="M9 11.3 H6.5" />
          <path d="M9 13.1 H6.3" />
          <path d="M9 14.9 H6.5" />
          <path d="M15 11.3 H17.5" />
          <path d="M15 13.1 H17.7" />
          <path d="M15 14.9 H17.5" />
        </g>
      )
    case "attention":
      return (
        <g stroke={glyph} strokeLinecap="round" fill="none">
          <path d="M12 7.3 V13.6" strokeWidth="2.2" />
          <path d="M12 16.4 L12 16.4" strokeWidth="2.6" />
        </g>
      )
  }
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
    // biome-ignore lint/a11y/noSvgWithoutTitle: role="img" and <title> are the same branch of this ternary as aria-hidden's opposite branch -- title set means both real; title unset means aria-hidden and no role. Never role="img" with an empty title.
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
    >
      {title ? <title>{title}</title> : null}
      <path d={SHIELD_PATH} fill="var(--rb-text)" />
      <path
        d={SHIELD_PATH}
        transform="translate(12 12) scale(0.86) translate(-12 -12)"
        fill="none"
        stroke="var(--rb-bg)"
        strokeWidth="0.9"
      />
      <ShieldGlyph variant={variant} />
    </svg>
  )
}
