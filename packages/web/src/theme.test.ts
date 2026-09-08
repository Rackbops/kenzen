import stylesManifest from "@rackbops/styles/manifest"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import {
  applyTheme,
  BUNDLED_THEMES,
  bootTheme,
  DEFAULT_THEME,
  loadTheme,
  resolveTheme,
  THEME_LOADERS,
} from "./theme.js"

// K4-7b acceptance (kenzen#24): "the resolver picks the right loader for a known name,
// falls back with a warning for an unknown name, and the default page imports only one
// theme." See theme.ts's own module docstring for the eager-vs-lazy history (K4-7,
// kenzen#9) this restores without the bundle cost.

let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  warnSpy.mockRestore()
})

/** Replaces every entry in THEME_LOADERS with a vi.fn() wrapping the real loader, runs
 * `run` against the resulting name -> spy map, then restores the originals -- even on
 * failure. Used to prove which loader(s) `loadTheme` actually invokes without exercising
 * real CSS module resolution (vitest mocks CSS imports to {} by default; a spy on the
 * loader function itself is the only way to tell "was this theme's loader called" apart
 * from "was some other theme's"). */
async function withLoaderSpies(
  run: (spies: ReadonlyMap<string, ReturnType<typeof vi.fn>>) => Promise<void>,
): Promise<void> {
  const originals = new Map<string, () => Promise<unknown>>()
  for (const name of BUNDLED_THEMES) {
    const loader = THEME_LOADERS[name]
    if (!loader) {
      throw new Error(`test setup: THEME_LOADERS has no entry for bundled theme ${name}`)
    }
    originals.set(name, loader)
  }
  const spies = new Map(Array.from(originals, ([name, loader]) => [name, vi.fn(loader)] as const))
  for (const [name, spy] of spies) {
    THEME_LOADERS[name] = spy
  }
  try {
    await run(spies)
  } finally {
    for (const [name, original] of originals) {
      THEME_LOADERS[name] = original
    }
  }
}

test("resolveTheme falls back to the default when unset", () => {
  expect(resolveTheme({})).toBe(DEFAULT_THEME)
  expect(resolveTheme({ VITE_KENZEN_THEME: undefined })).toBe(DEFAULT_THEME)
  expect(warnSpy).not.toHaveBeenCalled()
})

test("resolveTheme falls back on a blank value, matching config.ts's own convention", () => {
  expect(resolveTheme({ VITE_KENZEN_THEME: "" })).toBe(DEFAULT_THEME)
  expect(warnSpy).not.toHaveBeenCalled()
})

test("resolveTheme honors every bundled theme name, not just the default", () => {
  // Multi-theme is the actual point of K4-7b -- assert every theme @rackbops/styles
  // ships resolves to itself, not just DEFAULT_THEME.
  expect(BUNDLED_THEMES.length).toBeGreaterThan(1)
  for (const name of BUNDLED_THEMES) {
    expect(resolveTheme({ VITE_KENZEN_THEME: name })).toBe(name)
  }
  expect(warnSpy).not.toHaveBeenCalled()
})

test("resolveTheme falls back (with a warning) for a theme name with no matching CSS bundled", () => {
  // The K4-7 round-1 bug's real failure mode: a configured-but-unbundled theme used to be
  // applied to the DOM attribute anyway, silently rendering unstyled. Still fails safe.
  const unbundled = "not-a-real-rackbops-theme"
  expect(BUNDLED_THEMES as readonly string[]).not.toContain(unbundled)
  expect(resolveTheme({ VITE_KENZEN_THEME: unbundled })).toBe(DEFAULT_THEME)
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(unbundled))
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(DEFAULT_THEME))
})

test("BUNDLED_THEMES matches every theme @rackbops/styles actually publishes", () => {
  // Ties the resolver's allowlist to the design system's own manifest, rather than a
  // hand-maintained list here going stale -- this is the "every theme selectable" bullet.
  expect(BUNDLED_THEMES).toEqual(Object.keys(stylesManifest.themes).sort())
})

test("loadTheme invokes only the resolved theme's loader, never another bundled theme's", async () => {
  const nonDefault = BUNDLED_THEMES.find((name) => name !== DEFAULT_THEME)
  expect(nonDefault).toBeDefined()

  await withLoaderSpies(async (spies) => {
    await loadTheme(nonDefault as string)
    for (const [name, spy] of spies) {
      if (name === nonDefault) {
        expect(spy).toHaveBeenCalledTimes(1)
      } else {
        expect(spy).not.toHaveBeenCalled()
      }
    }
  })
})

test("the default boot path (no configured theme) loads exactly one theme's stylesheet", async () => {
  // What main.tsx actually does at boot: resolveTheme(env) then loadTheme(result). With no
  // VITE_KENZEN_THEME configured, only DEFAULT_THEME's chunk should ever be fetched -- this
  // is the "default page imports only one theme" bullet, proven at the loader-invocation
  // level (the real built-asset-size proof is executed separately per the issue's own
  // acceptance bullet 1).
  await withLoaderSpies(async (spies) => {
    await loadTheme(resolveTheme({}))
    for (const [name, spy] of spies) {
      if (name === DEFAULT_THEME) {
        expect(spy).toHaveBeenCalledTimes(1)
      } else {
        expect(spy).not.toHaveBeenCalled()
      }
    }
  })
})

test("loadTheme rejects a name with no loader and no fallback available", async () => {
  const original = THEME_LOADERS[DEFAULT_THEME]
  delete THEME_LOADERS[DEFAULT_THEME]
  try {
    await expect(loadTheme("not-a-real-rackbops-theme")).rejects.toThrow(/no stylesheet loader/)
  } finally {
    THEME_LOADERS[DEFAULT_THEME] = original as () => Promise<unknown>
  }
})

test("applyTheme sets data-rb-style on the given root to the resolved theme", () => {
  const root = document.createElement("html")
  applyTheme(resolveTheme({}), root)
  expect(root.dataset.rbStyle).toBe("arcane-obsidian")
  expect(root.getAttribute("data-rb-style")).toBe("arcane-obsidian")

  // An unbundled config value resolves to the (still real, still applied) default -- the
  // attribute always reflects a theme whose CSS is genuinely present.
  applyTheme(resolveTheme({ VITE_KENZEN_THEME: "some-future-theme" }), root)
  expect(root.dataset.rbStyle).toBe("arcane-obsidian")
})

test("bootTheme resolves, loads, then applies -- in that order -- and returns the resolved name", async () => {
  const root = document.createElement("html")
  let rbStyleWhileLoading: string | undefined

  await withLoaderSpies(async (spies) => {
    const defaultSpy = spies.get(DEFAULT_THEME)
    expect(defaultSpy).toBeDefined()
    defaultSpy?.mockImplementationOnce(async () => {
      // Captured mid-load: if bootTheme applied the theme BEFORE awaiting the load (an
      // order flip), this would already read DEFAULT_THEME instead of undefined.
      rbStyleWhileLoading = root.dataset.rbStyle
    })

    const resolved = await bootTheme({}, root)

    expect(resolved).toBe(DEFAULT_THEME)
    expect(defaultSpy).toHaveBeenCalledTimes(1)
  })

  expect(rbStyleWhileLoading).toBeUndefined()
  expect(root.dataset.rbStyle).toBe(DEFAULT_THEME)
})

test("bootTheme applies a configured non-default theme, not the default", async () => {
  const nonDefault = BUNDLED_THEMES.find((name) => name !== DEFAULT_THEME)
  expect(nonDefault).toBeDefined()
  const root = document.createElement("html")

  await withLoaderSpies(async (spies) => {
    const resolved = await bootTheme({ VITE_KENZEN_THEME: nonDefault }, root)
    expect(resolved).toBe(nonDefault)
    for (const [name, spy] of spies) {
      if (name === nonDefault) {
        expect(spy).toHaveBeenCalledTimes(1)
      } else {
        expect(spy).not.toHaveBeenCalled()
      }
    }
  })

  expect(root.dataset.rbStyle).toBe(nonDefault)
})
