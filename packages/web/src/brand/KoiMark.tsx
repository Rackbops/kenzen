import { useId } from "react"

/**
 * kenzen#89: the Code Stream Koi mark (epic #88) -- a robotic koi swimming right, traced from
 * `brand/source/koi-mark-glyphs.jpg`'s deep-navy glyph. Round 2 (orchestrator design call, live
 * screenshot review): the round-1 polygon silhouette read as an angular arrowhead/piranha, not
 * a koi -- koi-ness comes from a smooth, long, gently tapering bezier body with the angular
 * facets kept INSIDE it as seam lines, not from the outline itself being faceted. Redrawn to
 * that geometry; the round-1 fallback/mono/token-mapping design carries over unchanged.
 *
 * Every fill/stroke is a `--rb-*` token (STANDARD.md sections 12/15), so the mark recolors with
 * every theme rather than carrying its own brand hex; `brand-hex-guard.test.ts` enforces this at
 * the source level. `mono` swaps every token for `currentColor`, with seams/eye rendered as
 * `var(--rb-bg)` cut-outs instead -- the one-color glyph shape used where a favicon-style icon
 * can't read CSS custom properties at all (see `packages/web/public/favicon.svg`, which bakes
 * the light-theme hex values in as the one permitted exception to the token-only rule).
 */
export interface KoiMarkProps {
  /** Rendered width/height in px. Default 24. Below 24 (the header wordmark passes 22), the
   * mark drops to a reduced element set -- the facets, circuit trace, and pectoral fin don't
   * survive legibly at that size, so they're not drawn rather than drawn illegibly. */
  size?: number
  /** An accessible name. Present -> renders a `<title>` and `role="img"`. Absent -> purely
   * decorative (`aria-hidden="true"`), for placement next to text that already says "kenzen". */
  title?: string
  /** One-colour mode: the whole silhouette (body, tail, dorsal, pectoral) becomes one
   * `currentColor` union, with the seam/outline lines switching to `var(--rb-bg)` cut-outs
   * instead of `var(--rb-text)` -- a single-tone glyph that works without a full theme's token
   * set backing it. */
  mono?: boolean
}

const BODY_PATH = "M14 32 C20 20 38 16 56 30 C58 31 58 33 56 34 C38 48 20 44 14 32 Z"
const TAIL_PATH = "M14 32 L4 21 C9 27 9 37 4 43 Z"
const DORSAL_PATH = "M28 22 C33 12 43 13 47 21 Z"
const PECTORAL_PATH = "M40 36 C38 43 31 45 29 39 Z"
const FACET_PATHS = ["M30 22.5 Q31 32 30 41.5", "M38 20 Q39 32 38 44", "M46 21.5 Q47 32 46 40"]
const SPINE_PATH = "M27 22.8 C34 15.5 43 15.5 52 24"
const TRACE_PATH = "M22 34 H27 V30 H31"

export function KoiMark({ size = 24, title, mono = false }: KoiMarkProps) {
  const clipId = useId()
  // Below 24px the facets, circuit trace, and pectoral fin are the first detail to go muddy --
  // the header itself passes 22, so this threshold is what decides the header's own rendering,
  // not just the favicon's.
  const small = size < 24

  const bodyFill = mono ? "currentColor" : "var(--rb-accent)"
  const tailFill = mono ? "currentColor" : "var(--rb-accent-strong, var(--rb-accent))"
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
      <defs>
        <clipPath id={clipId}>
          <path d={BODY_PATH} />
        </clipPath>
      </defs>
      <path
        d={TAIL_PATH}
        fill={tailFill}
        stroke={seamColor}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <path
        d={BODY_PATH}
        fill={bodyFill}
        stroke={seamColor}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      {!small && (
        <>
          <path
            d={DORSAL_PATH}
            fill={bodyFill}
            stroke={seamColor}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
          <path d={PECTORAL_PATH} fill={bodyFill} />
          <g clipPath={`url(#${clipId})`}>
            {FACET_PATHS.map((d) => (
              <path
                key={d}
                d={d}
                fill="none"
                stroke={seamColor}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            ))}
          </g>
        </>
      )}
      <path d={SPINE_PATH} fill="none" stroke={traceColor} strokeWidth={2} strokeLinecap="round" />
      {!small && (
        <>
          <path
            d={TRACE_PATH}
            fill="none"
            stroke={traceColor}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={31} cy={30} r={1.1} fill={traceColor} />
        </>
      )}
      <circle cx={50} cy={28.5} r={2.4} fill={seamColor} />
      <circle cx={51} cy={27.7} r={0.8} fill="var(--rb-bg)" />
    </svg>
  )
}
