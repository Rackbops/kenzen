import { createContext, useContext } from "react"
import type { Scheme } from "./theme.js"

/** kenzen#128: the active theme's light/dark scheme, provided once by `App.tsx` from its
 * existing theme state (`schemeOf(theme)`) and read by any component that needs to pick a
 * scheme-specific asset -- `StatusShield` is the first consumer (a light-bodied shield on a
 * dark theme, since the shipped artwork's navy body vanishes into a dark page). Defaults to
 * `"light"` for anything rendered without a provider (every route-level test in this repo
 * renders a route component directly, not through `<App>`) -- the same safe default
 * `schemeOf` itself falls back to for an unbundled theme, so a shield rendered with no
 * provider behaves exactly like one on a light theme: today's unchanged navy artwork. */
export const SchemeContext = createContext<Scheme>("light")

export function useScheme(): Scheme {
  return useContext(SchemeContext)
}
