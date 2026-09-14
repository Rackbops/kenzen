import stylesManifest from "@rackbops/styles/manifest"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import {
  applyTheme,
  BUNDLED_THEMES,
  bootTheme,
  DEFAULT_THEME,
  loadTheme,
  orderedForPicker,
  resolveTheme,
  schemeOf,
  setTheme,
  THEME_LOADERS,
  THEME_STORAGE_KEY,
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

test("DEFAULT_THEME is Kenzen's own brand pair's light half, not a library default (kenzen#91)", () => {
  // Every other test in this file compares against the DEFAULT_THEME import itself, which
  // can't catch a regression to the wrong default (it would just move with the constant) --
  // this is the one place the literal value is pinned.
  expect(DEFAULT_THEME).toBe("kenzen-cyberhealth")
})

test("DEFAULT_THEME is always a bundled theme", () => {
  // resolveTheme returns DEFAULT_THEME unconditionally on the unconfigured path (theme.ts
  // ~line 111); an unbundled default would ship an unstyled page with an empty picker value.
  expect(BUNDLED_THEMES).toContain(DEFAULT_THEME)
})

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

// --- kenzen#91: the picker's Kenzen-pair-first, then-alphabetical order ---------------

test("orderedForPicker puts the Kenzen pair first (light before dark), then the rest alphabetical", () => {
  expect(orderedForPicker(BUNDLED_THEMES)).toEqual([
    "kenzen-cyberhealth",
    "kenzen-midnight",
    ...BUNDLED_THEMES.filter((name) => !name.startsWith("kenzen-")),
  ])
})

test("orderedForPicker is a no-op reorder: same members, none dropped or duplicated", () => {
  const result = orderedForPicker(BUNDLED_THEMES)
  expect(new Set(result)).toEqual(new Set(BUNDLED_THEMES))
  expect(result).toHaveLength(BUNDLED_THEMES.length)
})

test("orderedForPicker tolerates a theme list missing one or both pinned names", () => {
  const withoutKenzen = BUNDLED_THEMES.filter((name) => !name.startsWith("kenzen-"))
  expect(orderedForPicker(withoutKenzen)).toEqual(withoutKenzen)

  const onlyDark = withoutKenzen.concat("kenzen-midnight")
  expect(orderedForPicker(onlyDark)).toEqual(["kenzen-midnight", ...withoutKenzen])
})

test("orderedForPicker returns an empty array for an empty input", () => {
  expect(orderedForPicker([])).toEqual([])
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
  expect(root.dataset.rbStyle).toBe(DEFAULT_THEME)
  expect(root.getAttribute("data-rb-style")).toBe(DEFAULT_THEME)

  // An unbundled config value resolves to the (still real, still applied) default -- the
  // attribute always reflects a theme whose CSS is genuinely present.
  applyTheme(resolveTheme({ VITE_KENZEN_THEME: "some-future-theme" }), root)
  expect(root.dataset.rbStyle).toBe(DEFAULT_THEME)
})

// --- kenzen#128: scheme (dark/light), backing the dark-scheme StatusShield asset --------

test("schemeOf reads the real @rackbops/styles manifest, not a second hand-maintained list", () => {
  expect(schemeOf("kenzen-midnight")).toBe("dark")
  expect(schemeOf("kenzen-cyberhealth")).toBe("light")
})

test("schemeOf falls back to light for an unbundled/unknown theme name", () => {
  // The safe direction: the shield's original navy artwork already reads correctly on a
  // light page, so guessing "light" for a name the manifest doesn't recognize never makes a
  // real theme's shield vanish the way guessing "dark" could.
  expect(schemeOf("not-a-real-rackbops-theme")).toBe("light")
})

test("applyTheme sets data-rb-scheme alongside data-rb-style, matching the theme's real scheme", () => {
  const root = document.createElement("html")
  applyTheme("kenzen-midnight", root)
  expect(root.dataset.rbScheme).toBe("dark")
  applyTheme("kenzen-cyberhealth", root)
  expect(root.dataset.rbScheme).toBe("light")
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

test("bootTheme still resolves and applies the theme when loadTheme rejects", async () => {
  // Real HIGH, live-reproduced against a real build: main.tsx top-level-awaits bootTheme
  // before mounting React, so an unhandled rejection here (a real network/chunk-load
  // failure fetching the theme's CSS) left the page permanently blank -- no React tree
  // ever mounted, no way to recover short of a manual reload.
  const root = document.createElement("html")

  await withLoaderSpies(async (spies) => {
    const defaultSpy = spies.get(DEFAULT_THEME)
    expect(defaultSpy).toBeDefined()
    defaultSpy?.mockRejectedValueOnce(new Error("network blip fetching theme CSS"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const resolved = await bootTheme({}, root)

    expect(resolved).toBe(DEFAULT_THEME)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(DEFAULT_THEME), expect.any(Error))
    errorSpy.mockRestore()
  })

  // The DOM still reflects the intended theme even though its CSS didn't load this time --
  // a later successful fetch (retry, revalidation) needs no extra wiring to take effect.
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

// --- kenzen#82: a per-browser localStorage override, injected as `storage` -------------

/** A minimal Pick<Storage, "getItem"> (or "getItem" | "setItem") backed by a plain Map --
 * real localStorage isn't needed (and isn't reliably present in every test environment);
 * resolveTheme/setTheme are pure with respect to whatever object implements this shape. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size
    },
  }
}

// The full precedence table (kenzen#82's design decision 2): stored valid / stored unknown
// (falls through, doesn't just default) / env only / neither.

test("resolveTheme: a valid stored theme wins over VITE_KENZEN_THEME", () => {
  const nonDefault = BUNDLED_THEMES.find((name) => name !== DEFAULT_THEME) as string
  const other = BUNDLED_THEMES.find((name) => name !== nonDefault) as string
  const storage = fakeStorage({ [THEME_STORAGE_KEY]: nonDefault })
  expect(resolveTheme({ VITE_KENZEN_THEME: other }, storage)).toBe(nonDefault)
  expect(warnSpy).not.toHaveBeenCalled()
})

test("resolveTheme: an unknown stored theme is ignored (warns), falling through to VITE_KENZEN_THEME", () => {
  const configured = BUNDLED_THEMES.find((name) => name !== DEFAULT_THEME) as string
  const storage = fakeStorage({ [THEME_STORAGE_KEY]: "not-a-real-rackbops-theme" })
  expect(resolveTheme({ VITE_KENZEN_THEME: configured }, storage)).toBe(configured)
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("not-a-real-rackbops-theme"))
})

test("resolveTheme: an unknown stored theme with no env configured falls through to the default", () => {
  const storage = fakeStorage({ [THEME_STORAGE_KEY]: "not-a-real-rackbops-theme" })
  expect(resolveTheme({}, storage)).toBe(DEFAULT_THEME)
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("not-a-real-rackbops-theme"))
})

test("resolveTheme: VITE_KENZEN_THEME alone still works with no storage argument at all", () => {
  const nonDefault = BUNDLED_THEMES.find((name) => name !== DEFAULT_THEME) as string
  expect(resolveTheme({ VITE_KENZEN_THEME: nonDefault })).toBe(nonDefault)
  expect(warnSpy).not.toHaveBeenCalled()
})

test("resolveTheme: neither storage nor env set falls back to the default", () => {
  const storage = fakeStorage({})
  expect(resolveTheme({}, storage)).toBe(DEFAULT_THEME)
  expect(warnSpy).not.toHaveBeenCalled()
})

test("setTheme loads, applies, and persists the chosen theme, in that order", async () => {
  const nonDefault = BUNDLED_THEMES.find((name) => name !== DEFAULT_THEME) as string
  const root = document.createElement("html")
  const storage = fakeStorage()

  await withLoaderSpies(async (spies) => {
    const spy = spies.get(nonDefault)
    expect(spy).toBeDefined()

    await setTheme(nonDefault, root, storage)

    expect(spy).toHaveBeenCalledTimes(1)
  })

  expect(root.dataset.rbStyle).toBe(nonDefault)
  expect(storage.getItem(THEME_STORAGE_KEY)).toBe(nonDefault)
})

test("setTheme does not persist when loadTheme rejects", async () => {
  // Mirrors bootTheme's own "applyTheme still runs on the caught path" contract at the
  // loadTheme level: setTheme deliberately does NOT catch here (kenzen#82 -- the caller,
  // the picker's onChange, decides how a failed switch surfaces), so a rejection must
  // propagate rather than silently persisting a theme whose CSS never loaded.
  const nonDefault = BUNDLED_THEMES.find((name) => name !== DEFAULT_THEME) as string
  const root = document.createElement("html")
  const storage = fakeStorage()
  const original = THEME_LOADERS[nonDefault]
  THEME_LOADERS[nonDefault] = vi.fn().mockRejectedValue(new Error("network blip"))

  try {
    await expect(setTheme(nonDefault, root, storage)).rejects.toThrow("network blip")
  } finally {
    THEME_LOADERS[nonDefault] = original as () => Promise<unknown>
  }

  expect(root.dataset.rbStyle).toBeUndefined()
  expect(storage.getItem(THEME_STORAGE_KEY)).toBeNull()
})

test("bootTheme forwards storage to resolveTheme, so a stored override applies at boot too", async () => {
  const nonDefault = BUNDLED_THEMES.find((name) => name !== DEFAULT_THEME) as string
  const root = document.createElement("html")
  const storage = fakeStorage({ [THEME_STORAGE_KEY]: nonDefault })

  await withLoaderSpies(async (spies) => {
    const resolved = await bootTheme({}, root, storage)
    expect(resolved).toBe(nonDefault)
    const spy = spies.get(nonDefault)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  expect(root.dataset.rbStyle).toBe(nonDefault)
})
