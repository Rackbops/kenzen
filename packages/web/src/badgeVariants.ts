import type { SemanticVariant } from "@rackbops/ui-react"
import type { StatusShieldVariant } from "./brand/StatusShield.js"

/** Maps a ReportItem's gap/advisoryStatus to the design system's semantic Badge variant.
 * Kenzen-specific (these are Kenzen's own enum values), so this stays out of components/. */

export function gapVariant(gap: string | null): SemanticVariant | undefined {
  switch (gap) {
    case "major":
      return "danger"
    case "minor":
      return "warning"
    case "patch":
      return "info"
    case "none":
      return "success"
    default:
      return undefined
  }
}

export function advisoryVariant(status: string | null): SemanticVariant | undefined {
  switch (status) {
    case "affected":
      return "danger"
    case "historical-only":
      return "warning"
    case "none":
      return "success"
    default:
      return undefined
  }
}

/** kenzen#90: which StatusShield glyph (if any) leads the gap Badge. Deliberately narrower
 * than gapVariant's switch -- the issue's design decision names exactly major/minor
 * (attention) and none (healthy); "patch" gets no shield rather than a guessed one. */
export function gapShieldVariant(gap: string | null): StatusShieldVariant | undefined {
  switch (gap) {
    case "major":
    case "minor":
      return "attention"
    case "none":
      return "healthy"
    default:
      return undefined
  }
}

/** kenzen#90: which StatusShield glyph (if any) leads the advisory Badge. "historical-only"
 * is the real enum value behind the issue's "historical" -- there is no literal "acknowledged"
 * advisoryStatus, so that word is read as describing the same resolved state. "unknown" gets
 * no shield: asserting "healthy" for a status that is, by name, not known would overclaim. */
export function advisoryShieldVariant(status: string | null): StatusShieldVariant | undefined {
  switch (status) {
    case "affected":
      return "vulnerable"
    case "historical-only":
      return "healthy"
    default:
      return undefined
  }
}
