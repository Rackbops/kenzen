import "@rackbops/styles/arcane-obsidian"

/**
 * The active `@rackbops/styles` theme -- "switchable by config" (design.md sections 3/6) via
 * a build-time Vite env var, not a live server round-trip: Kenzen is single-tenant, so a
 * redeploy choosing a different theme is enough for now, and this mechanism doesn't preclude
 * a future per-viewer or live-switchable theme layering on top later.
 *
 * `@rackbops/styles/arcane-obsidian`'s own tokens.css: "Nothing applies until an element
 * carries data-rb-style=... -- set it on <html> for a page." Only arcane-obsidian's CSS is
 * imported (the one theme Kenzen actually uses, per design.md section 3's "arcane-obsidian as
 * the other apps") -- switching to a genuinely different theme means importing that theme's
 * CSS here too, alongside changing the resolved value.
 */
export const DEFAULT_THEME = "arcane-obsidian"

/** Pure: resolveTheme(import.meta.env) at the call site, injected so it unit-tests without
 * depending on Vite's real env object. */
export function resolveTheme(env: Record<string, string | boolean | undefined>): string {
  const configured = env.VITE_KENZEN_THEME
  return typeof configured === "string" && configured !== "" ? configured : DEFAULT_THEME
}

export function applyTheme(theme: string, root: HTMLElement): void {
  root.dataset.rbStyle = theme
}
