export interface SparklineProps {
  /** Oldest first -- the caller orders this; Sparkline only ever draws left-to-right in the
   * order given, it never re-sorts. */
  values: number[]
  /** Read by assistive tech in place of the SVG's own (purely visual) content -- e.g.
   * "behind, 8 to 15 over 6 snapshots". */
  label: string
  width?: number
  height?: number
}

const DEFAULT_WIDTH = 96
const DEFAULT_HEIGHT = 24
const PADDING = 2

/**
 * A compact inline trend line -- design.md section 6's "soundness line over time" (kenzen#38),
 * deliberately not a full chart: no axes, no legend, no library, and generic (plots any
 * `number[]`, not soundness-specific -- the caller decides which field of a `Soundness` series
 * to plot).
 *
 * Renders nothing for fewer than 2 points: a single number has no trend to draw, and the
 * caller's own text line already states the current value, so an empty/degenerate chart would
 * add nothing. A perfectly flat series (every value equal) draws a flat MIDLINE rather than a
 * flat line pinned to the bottom of the box -- pinning to the bottom would visually read as
 * "worst case" even when the flat value is, say, a healthy zero.
 *
 * `stroke="currentColor"` rather than a design-token color: this always inherits whatever text
 * color is already active in its container, with zero risk of referencing an `--rb-*` token
 * that turns out not to exist.
 */
export function Sparkline({
  values,
  label,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
}: SparklineProps) {
  if (values.length < 2) {
    return null
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const flat = min === max
  const innerWidth = width - PADDING * 2
  const innerHeight = height - PADDING * 2
  const lastIndex = values.length - 1

  const coords = values.map((v, i) => {
    const x = PADDING + (lastIndex === 0 ? 0 : (i / lastIndex) * innerWidth)
    const y = flat
      ? PADDING + innerHeight / 2
      : PADDING + innerHeight - ((v - min) / (max - min)) * innerHeight
    return { x, y }
  })
  // Unreachable given the length check above (coords has the same length as values, >= 2), but
  // satisfies noUncheckedIndexedAccess without a non-null assertion.
  const lastPoint = coords[coords.length - 1] ?? { x: PADDING, y: PADDING + innerHeight / 2 }

  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <polyline
        points={coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      />
      <circle cx={lastPoint.x} cy={lastPoint.y} r={2} fill="currentColor" />
    </svg>
  )
}
