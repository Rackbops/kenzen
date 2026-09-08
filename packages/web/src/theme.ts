import "@rackbops/styles/arcane-obsidian"

/**
 * The active `@rackbops/styles` theme name, read from a build-time Vite env var
 * (design.md sections 3/6's "switchable by config") -- not a live server round-trip:
 * Kenzen is single-tenant, so a redeploy choosing a different theme is enough, and this
 * doesn't preclude a future per-viewer or live-switchable theme layering on top later.
 *
 * K4-7 review round 1, HIGH, live-verified, then reconsidered: an earlier version of this
 * file imported `@rackbops/styles/all` (every theme) so `resolveTheme` could genuinely
 * resolve to ANY theme name with matching CSS present -- but `all.css` pulls in all twelve
 * themes' CSS, and `neon-butterfly` alone bundles a 1.3MB background image none of Kenzen's
 * actual deployments (design.md section 7: arcane-obsidian only) will ever use. Measured
 * live: the built CSS bundle grew from 22.9kB to 286.5kB, plus that 1.3MB image asset, for
 * eleven themes nothing in this app's real deployment plan configures.
 *
 * Only `arcane-obsidian`'s CSS -- the one theme any current Kenzen deployment actually
 * uses -- is imported, so this module's OWN capability is genuinely narrower than
 * "any @rackbops/styles theme name." `resolveTheme` validates against `BUNDLED_THEMES` and
 * falls back to the default (logging a warning) for anything else, rather than repeating
 * the round-1 bug's real failure mode: silently applying an unstyled configured value with
 * no signal anything is wrong. Deploying a genuinely different theme means adding its
 * import here too (one line, following this same pattern) AND adding it to
 * `BUNDLED_THEMES`, as a deliberate, reviewed change when that's a real need -- not
 * speculatively bundling all twelve today for a need nothing has yet.
 */
export const DEFAULT_THEME = "arcane-obsidian"

/** Every theme name this module actually has matching CSS for -- see the module docstring
 * for why this isn't "any @rackbops/styles theme." `resolveTheme` validates against this;
 * keep it in sync with the CSS imports at the top of this file. */
export const BUNDLED_THEMES = [DEFAULT_THEME] as const

/** Pure: resolveTheme(import.meta.env) at the call site, injected so it unit-tests without
 * depending on Vite's real env object. Falls back to DEFAULT_THEME (with a console warning)
 * for anything not in BUNDLED_THEMES, so a typo'd or not-yet-bundled theme name fails safe
 * (a working default, loudly) instead of silently shipping an unstyled page. */
export function resolveTheme(env: Record<string, string | boolean | undefined>): string {
  const configured = env.VITE_KENZEN_THEME
  if (typeof configured !== "string" || configured === "") {
    return DEFAULT_THEME
  }
  if (!(BUNDLED_THEMES as readonly string[]).includes(configured)) {
    console.warn(
      `VITE_KENZEN_THEME=${JSON.stringify(configured)} has no matching CSS bundled ` +
        `(BUNDLED_THEMES: ${BUNDLED_THEMES.join(", ")}) -- falling back to ${DEFAULT_THEME}.`,
    )
    return DEFAULT_THEME
  }
  return configured
}

export function applyTheme(theme: string, root: HTMLElement): void {
  root.dataset.rbStyle = theme
}
