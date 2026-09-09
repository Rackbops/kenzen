/**
 * kenzen#89: the Code Stream Koi mark (epic #88) -- a robotic koi swimming right, traced from
 * `brand/source/koi-mark-glyphs.jpg`'s deep-navy glyph at the epic's stated level of
 * simplification (armor plates, seams, a forked tail, dorsal fin, a spine glow line, one
 * circuit-trace detail), not the reference's full segment count -- it has to read at 16px.
 *
 * Every fill/stroke is a `--rb-*` token (STANDARD.md sections 12/15), so the mark recolors with
 * every theme rather than carrying its own brand hex; `brand-hex-guard.test.ts` enforces this at
 * the source level. `mono` swaps every token for `currentColor`, with seams/eye rendered as
 * `var(--rb-bg)` cut-outs instead -- the one-color glyph shape used where a favicon-style icon
 * can't read CSS custom properties at all (see `packages/web/public/favicon.svg`, which bakes
 * the light-theme hex values in as the one permitted exception to the token-only rule).
 */
export interface KoiMarkProps {
  /** Rendered width/height in px. Default 24 (the header wordmark's own size, passed as 22
   * there to sit inside the existing `rb-wordmark` line height). */
  size?: number
  /** An accessible name. Present -> renders a `<title>` and `role="img"`. Absent -> purely
   * decorative (`aria-hidden="true"`), for placement next to text that already says "kenzen". */
  title?: string
  /** One-colour mode: every themed fill becomes `currentColor` and every seam/eye line becomes
   * `var(--rb-bg)` instead of `var(--rb-text)`, so the mark works as a single-tone glyph (e.g.
   * over a solid background) without a full theme's token set backing it. */
  mono?: boolean
}

export function KoiMark({ size = 24, title, mono = false }: KoiMarkProps) {
  const bodyFill = mono ? "currentColor" : "var(--rb-accent)"
  const plateFill = mono ? "currentColor" : "var(--rb-accent-strong, var(--rb-accent))"
  const seamColor = mono ? "var(--rb-bg)" : "var(--rb-text)"
  const traceColor = mono ? "currentColor" : "var(--rb-success)"

  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: <title> below is conditional on `title`; absent, the svg is aria-hidden instead -- the correct pattern for a decorative mark, which Biome's static check can't see through.
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
    >
      {title ? <title>{title}</title> : null}
      {/* Body silhouette: snout -> forehead -> dorsal fin -> spine ridge -> forked tail ->
          belly -> pectoral fin -> jaw -> back to the snout. */}
      <polygon
        points="58,30 50,21 42,18 34,7 26,18 16,15 6,6 13,28 6,50 18,39 30,42 40,34 48,37"
        fill={bodyFill}
        stroke={seamColor}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      {/* Armor-plate facets: filled for shading in colour mode, and their own boundary doubles
          as a seam line (in mono, the fill matches the body so only the seam stroke shows,
          reading as a cut-out crease rather than a shaded panel). */}
      <polygon
        points="42,18 50,21 44,30 36,26"
        fill={plateFill}
        stroke={seamColor}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <polygon
        points="26,18 36,26 30,36 18,30"
        fill={plateFill}
        stroke={seamColor}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {/* Spine glow: the one line that reads as "powered on" rather than structural. */}
      <polyline
        points="46,19 16,15"
        fill="none"
        stroke={traceColor}
        strokeWidth={2}
        strokeLinecap="round"
      />
      {/* Circuit trace: a single right-angle etched into the rear plate, plus its via node. */}
      <polyline
        points="34,31 40,31 40,25"
        fill="none"
        stroke={traceColor}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="40" cy="25" r="1.6" fill={traceColor} />
      {/* Eye: a solid seam-coloured disc with a bg-coloured highlight, always -- the highlight
          is the one element that's `var(--rb-bg)` in both modes, since it's a cut-out either
          way, not a themed fill. */}
      <circle cx="48" cy="26" r="3.4" fill={seamColor} />
      <circle cx="49" cy="25" r="1.2" fill="var(--rb-bg)" />
    </svg>
  )
}
