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
    case "range-floor":
      return "info"
    case "none":
      return "success"
    default:
      return undefined
  }
}

/** kenzen#113: severity rank for the Advisories column's sortValue, ascending -- lower sorts
 * first, so the most-urgent rows (affected) lead. Mirrors advisoryVariant's own case order
 * (danger, warning, info, success, then everything else) rather than re-deriving it from the
 * SemanticVariant string, since "unknown" and null both fall through the same default there. */
export function advisoryVariantRank(status: string | null): number {
  switch (status) {
    case "affected":
      return 0
    case "historical-only":
      return 1
    case "range-floor":
      return 2
    case "none":
      return 3
    default:
      return 4
  }
}

/** kenzen#124: the badge text for an item's advisoryStatus, shorter than the raw enum value so
 * a wider (illegible-at-11px-fixed, kenzen#124) badge still fits its column. `"affected"` keeps
 * its count (`"N affected"`, unchanged from before this issue); `"historical-only"` shortens to
 * `"historical"`; `"range-floor"` (Tooling#705) becomes `"range floor"` (a hyphen reads oddly as
 * prose inside a pill); anything else (`"none"`, `"unknown"`, a future value) renders verbatim
 * rather than guessing a shorter form for a case this function doesn't know about; `null` is
 * `""`, matching every other renderer here treating no status as nothing to show.
 *
 * Display only -- `ItemFilters`'s `?status=` filter and the API keep the raw enum value; this
 * never changes what a status IS, only how it reads in a table cell. */
export function advisoryLabel(status: string | null, affectedCount: number): string {
  switch (status) {
    case "affected":
      return `${affectedCount} affected`
    case "historical-only":
      return "historical"
    case "range-floor":
      return "range floor"
    default:
      return status ?? ""
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
 * no shield: asserting "healthy" for a status that is, by name, not known would overclaim.
 * "range-floor" (Tooling#705) gets none either, for the same reason: it means an advisory's
 * range contains the unlocked manifest floor, not any version actually installed -- asserting
 * "healthy" or "vulnerable" for that would overclaim either way. */
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
