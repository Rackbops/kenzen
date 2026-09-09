/**
 * The active `@rackbops/styles` theme name, read from a build-time Vite env var
 * (design.md sections 3/6's "switchable by config") -- not a live server round-trip:
 * Kenzen is single-tenant, so a redeploy choosing a different theme is enough, and this
 * doesn't preclude a future per-viewer or live-switchable theme layering on top later.
 *
 * K4-7 (kenzen#9) imported only `arcane-obsidian`'s CSS eagerly and validated the
 * configured value against that one-entry `BUNDLED_THEMES` allowlist, because eagerly
 * importing every theme (`@rackbops/styles/all`) grew the built CSS 22.9kB -> 286.5kB,
 * plus a 1.3MB `neon-butterfly` background image, for themes nothing configured used --
 * see kenzen#9's theme-scope comment. That made "switchable by config" true only for a
 * single theme name.
 *
 * K4-7b (kenzen#24, roshne: "make it multi themed!") restores every `@rackbops/styles`
 * theme as a genuinely selectable config value WITHOUT paying that eager-bundle cost:
 * `import.meta.glob` over the package's per-theme `index.css` files, called WITHOUT
 * `eager: true`, compiles each match to a `() => import(...)` loader -- Vite gives each
 * matched theme's CSS its own chunk, fetched only when that specific loader is invoked.
 * `loadTheme` awaits exactly one loader (the resolved theme's) at boot, in `main.tsx`.
 * The default boot therefore still ships exactly one theme's CSS, same as K4-7; a
 * deployment configured for a different bundled theme ships that one theme's CSS
 * instead -- never more than one at a time. Omitting `eager: true` is the entire fix:
 * adding it back would reintroduce the exact all-themes-eager cost K4-7 measured and
 * backed out of.
 */

// One lazy CSS-module loader per theme this package ships, keyed by theme name (e.g.
// "arcane-obsidian" -> loader for ".../styles/arcane-obsidian/index.css"). The glob
// pattern is relative to THIS file, resolving through packages/web's own node_modules
// (a pnpm symlink into the workspace's @rackbops/styles install) -- see the theme
// directory layout under node_modules/@rackbops/styles for what a "theme" is on disk.
// `import.meta.glob` returns loader functions, not resolved modules -- nothing here
// executes a network/module fetch until `loadTheme` calls one of them.
const THEME_STYLESHEET_GLOB = import.meta.glob("../node_modules/@rackbops/styles/*/index.css")

function themeNameFromGlobPath(path: string): string | undefined {
  return /\/styles\/([^/]+)\/index\.css$/.exec(path)?.[1]
}

/** name -> lazy CSS-module loader. Mutable and exported for tests only (to spy on/swap
 * individual loaders without touching real CSS module resolution) -- production code
 * should always go through `loadTheme`, never read or write this map directly. */
export const THEME_LOADERS: Record<string, () => Promise<unknown>> = {}
for (const [path, loader] of Object.entries(THEME_STYLESHEET_GLOB)) {
  const name = themeNameFromGlobPath(path)
  if (name) {
    THEME_LOADERS[name] = loader
  }
}

/** kenzen#91: Kenzen's own cyber-health brand pair (rackbops-ui-ux-std-lib#158), adopted
 * as the deployment default -- not one of the library's generic "pick by kind" themes
 * (STANDARD.md section 15), so there is no by-kind default to defer to. */
export const DEFAULT_THEME = "kenzen-cyberhealth"

/** Every theme name this module can lazily load -- derived from the glob above, so it
 * stays in sync with whatever themes @rackbops/styles actually ships without a
 * hand-maintained list. `resolveTheme` validates a configured name against this.
 * Sorted for a deterministic, testable order. */
export const BUNDLED_THEMES = Object.keys(THEME_LOADERS).sort() as readonly string[]

/** kenzen#91: Kenzen's own theme pair, listed first (light before dark) in the header
 * picker -- everything else stays alphabetical. Kept separate from `BUNDLED_THEMES`
 * itself (which every other consumer -- `resolveTheme`'s validation, `loadTheme`'s
 * lookup -- uses as a plain membership/iteration set with no display-order meaning) so
 * this reorder is visible only where a display order actually matters. */
const PINNED_FIRST = ["kenzen-cyberhealth", "kenzen-midnight"] as const

/** Pure and independently testable: the picker's option order is `PINNED_FIRST`'s
 * members (in that order, skipping any not actually present in `themes`) followed by
 * every remaining name in `themes`' own order -- callers pass the already-alphabetical
 * `BUNDLED_THEMES`, so "the rest" comes out alphabetical without this function sorting
 * anything itself. */
export function orderedForPicker(themes: readonly string[]): string[] {
  const pinned = PINNED_FIRST.filter((name) => themes.includes(name))
  const rest = themes.filter((name) => !(PINNED_FIRST as readonly string[]).includes(name))
  return [...pinned, ...rest]
}

/** localStorage key for the viewer's own theme override (kenzen#82) -- a per-browser
 * preference, never sent to the server: it overrides the deployment's `VITE_KENZEN_THEME`
 * default for this browser only, the same way a viewer preference should never become
 * decision state. */
export const THEME_STORAGE_KEY = "kenzen.theme"

/** Pure: resolveTheme(import.meta.env, window.localStorage) at the call site, both injected
 * so it unit-tests without depending on Vite's real env object or a real Storage. Precedence
 * (kenzen#82): a bundled theme name in `storage` wins over `env.VITE_KENZEN_THEME`, which
 * wins over DEFAULT_THEME -- `storage` is the viewer's own override of the deployment
 * default, not a replacement for it. `storage` is optional so every existing single-argument
 * call (bootTheme with no viewer override yet resolved, every pre-#82 test) keeps working
 * unchanged. Falls back with the same console warning shape for an unbundled name from
 * EITHER source, so a typo'd or unrecognized theme name fails safe (a working default,
 * loudly) instead of silently shipping an unstyled page. */
export function resolveTheme(
  env: Record<string, string | boolean | undefined>,
  storage?: Pick<Storage, "getItem">,
): string {
  const stored = storage?.getItem(THEME_STORAGE_KEY)
  if (stored) {
    if ((BUNDLED_THEMES as readonly string[]).includes(stored)) {
      return stored
    }
    console.warn(
      `${THEME_STORAGE_KEY}=${JSON.stringify(stored)} has no matching CSS bundled ` +
        `(BUNDLED_THEMES: ${BUNDLED_THEMES.join(", ")}) -- ignoring the stored override.`,
    )
  }
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

/** Fetches and applies the resolved theme's stylesheet as a side effect, awaited once at
 * boot (`main.tsx`) before the app renders -- this is the one place a theme's CSS chunk is
 * actually requested. `theme` must already be a resolved (i.e. bundled) name; pass it
 * `resolveTheme`'s return value, never a raw config value. Falls back to loading
 * DEFAULT_THEME's stylesheet if `theme` somehow names a loader this module doesn't have
 * (defensive -- `resolveTheme` should never hand back an unbundled name). */
export async function loadTheme(theme: string): Promise<void> {
  const loader = THEME_LOADERS[theme] ?? THEME_LOADERS[DEFAULT_THEME]
  if (!loader) {
    throw new Error(
      `theme.ts: no stylesheet loader for ${JSON.stringify(theme)} or the default ` +
        `${JSON.stringify(DEFAULT_THEME)} -- BUNDLED_THEMES: ${BUNDLED_THEMES.join(", ")}`,
    )
  }
  await loader()
}

export function applyTheme(theme: string, root: HTMLElement): void {
  root.dataset.rbStyle = theme
}

/** Live theme switch (kenzen#82), driven by the header picker: load the next theme's
 * stylesheet, apply it, then persist the viewer's choice -- in that order, so a rejected
 * `loadTheme` (a real network/chunk-load failure) never persists a theme whose CSS isn't
 * actually loaded. Unlike `bootTheme`, this does NOT catch that rejection: it runs in
 * response to a user action, not a page-blocking top-level await, so the caller (the
 * picker's onChange handler) is the right place to decide how a failed switch should be
 * surfaced. Both the old and new themes' stylesheets stay loaded -- `loadTheme` never
 * unloads anything -- so switching back is instant and there is no page reload. */
export async function setTheme(
  next: string,
  root: HTMLElement,
  storage: Pick<Storage, "setItem">,
): Promise<void> {
  await loadTheme(next)
  applyTheme(next, root)
  storage.setItem(THEME_STORAGE_KEY, next)
}

/** The single entry point `main.tsx` calls at boot: resolve the configured theme, await
 * its stylesheet load, THEN apply it to `root` -- in that order, so `root`'s
 * `data-rb-style` attribute is never set to a theme whose CSS hasn't finished loading.
 * Pulled out of `main.tsx` (which also mounts the React tree and isn't itself unit-tested)
 * so the resolve -> load -> apply sequence has real, direct test coverage. Returns the
 * resolved theme name for callers that want to log/assert it.
 *
 * `storage` is optional (kenzen#82) and forwarded to `resolveTheme` unchanged -- omit it
 * and boot resolves purely from `env`, exactly as before this existed.
 *
 * A rejected `loadTheme` -- a real network/chunk-load failure, not a resolveTheme-level
 * misconfiguration -- is caught and logged, not rethrown: `main.tsx` top-level-`await`s
 * this before mounting, so an unhandled rejection here would leave the page permanently
 * blank (no React tree ever mounts) instead of degrading to one unstyled first paint.
 * `applyTheme` still runs on the caught path -- `data-rb-style` reflects the intended
 * theme even though its CSS didn't load this time, so a later successful chunk fetch (a
 * retry, a service-worker revalidation) needs no extra wiring to take effect. */
export async function bootTheme(
  env: Record<string, string | boolean | undefined>,
  root: HTMLElement,
  storage?: Pick<Storage, "getItem">,
): Promise<string> {
  const theme = resolveTheme(env, storage)
  try {
    await loadTheme(theme)
  } catch (err) {
    console.error(`theme.ts: failed to load "${theme}"'s stylesheet -- rendering unstyled.`, err)
  }
  applyTheme(theme, root)
  return theme
}
