import type { SemanticVariant } from "@rackbops/ui-react"

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
