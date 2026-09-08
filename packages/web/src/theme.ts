/**
 * The active `@rackbops/styles` theme, read from a build-time Vite env var
 * (design.md sections 3/6's "switchable by config") -- not a live server round-trip:
 * Kenzen is single-tenant, so a redeploy choosing a different theme is enough, and this
 * doesn't preclude a future per-viewer or live-switchable theme layering on top later.
 *
 * K4-7 review round 1 (HIGH) found that statically importing only `arcane-obsidian`'s CSS
 * meant any OTHER configured theme name applied `data-rb-style` with no matching CSS
 * bundled, rendering completely unstyled. The first fix imported every theme
 * (`@rackbops/styles/all`) to make any name genuinely work, then reverted that after
 * measuring the real cost: the CSS bundle grew from 22.9kB to 286.5kB, plus a 1.3MB
 * background image `neon-butterfly` alone bundles, all loaded on every single page view
 * regardless of which theme is actually configured.
 *
 * K4-7 round 2 (orchestrator design call): the real fix isn't "bundle none but the
 * default" or "bundle all twelve eagerly" -- it's loading only the CONFIGURED theme,
 * lazily. `THEME_LOADERS` is one dynamic `import()` per theme, each a literal string
 * Vite's bundler can statically resolve and code-split into its own chunk; only the
 * loader the resolved theme name actually indexes into ever executes, so the page's
 * initial load still costs one theme's CSS (~23kB), and a second, third, or all twelve
 * configured across different deploys each cost only their own chunk, fetched on demand.
 * `@rackbops/styles` has no glob-able `themes/*.css` directory to feed
 * `import.meta.glob` -- each theme is its own named package.json `exports` subpath -- so
 * this is an explicit, exhaustive lookup table instead, kept in sync with the twelve
 * themes `@rackbops/styles`'s own `all.css` documents.
 */
const THEME_LOADERS: Record<string, () => Promise<unknown>> = {
  "arcane-obsidian": () => import("@rackbops/styles/arcane-obsidian"),
  "arcane-parchment": () => import("@rackbops/styles/arcane-parchment"),
  "rackbops-studio": () => import("@rackbops/styles/rackbops-studio"),
  "rackbops-noir": () => import("@rackbops/styles/rackbops-noir"),
  "luminous-precision": () => import("@rackbops/styles/luminous-precision"),
  "neon-butterfly": () => import("@rackbops/styles/neon-butterfly"),
  "summer-cloud": () => import("@rackbops/styles/summer-cloud"),
  "concrete-signal": () => import("@rackbops/styles/concrete-signal"),
  "concrete-signal-light": () => import("@rackbops/styles/concrete-signal-light"),
  "amber-hearth": () => import("@rackbops/styles/amber-hearth"),
  "amber-ember": () => import("@rackbops/styles/amber-ember"),
  "mono-field": () => import("@rackbops/styles/mono-field"),
}

export const DEFAULT_THEME = "arcane-obsidian"

/** Every theme name Kenzen can actually load, lazily, on demand -- see the module
 * docstring. `resolveTheme` validates against this; keep it in sync with
 * `THEME_LOADERS` (it's derived from the same object, so it always is). */
export const AVAILABLE_THEMES = Object.keys(THEME_LOADERS) as readonly string[]

/** Pure: resolveTheme(import.meta.env) at the call site, injected so it unit-tests without
 * depending on Vite's real env object. Falls back to DEFAULT_THEME (with a console warning)
 * for anything not in AVAILABLE_THEMES, so a typo'd theme name fails safe (a working
 * default, loudly) instead of silently shipping an unstyled page. */
export function resolveTheme(env: Record<string, string | boolean | undefined>): string {
  const configured = env.VITE_KENZEN_THEME
  if (typeof configured !== "string" || configured === "") {
    return DEFAULT_THEME
  }
  if (!AVAILABLE_THEMES.includes(configured)) {
    console.warn(
      `VITE_KENZEN_THEME=${JSON.stringify(configured)} is not a real @rackbops/styles theme ` +
        `(available: ${AVAILABLE_THEMES.join(", ")}) -- falling back to ${DEFAULT_THEME}.`,
    )
    return DEFAULT_THEME
  }
  return configured
}

/** Dynamically imports `theme`'s CSS (a no-op if it's already been loaded once -- the
 * browser/Vite module cache makes a repeat import() for the same specifier resolve
 * immediately without re-fetching). Throws if `theme` isn't a real key of THEME_LOADERS;
 * callers are expected to have already resolved/validated via resolveTheme. */
export async function loadTheme(theme: string): Promise<void> {
  const load = THEME_LOADERS[theme]
  if (!load) {
    throw new Error(`loadTheme: ${JSON.stringify(theme)} is not in AVAILABLE_THEMES`)
  }
  await load()
}

export function applyTheme(theme: string, root: HTMLElement): void {
  root.dataset.rbStyle = theme
}
