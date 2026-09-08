import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { AVAILABLE_THEMES, applyTheme, DEFAULT_THEME, loadTheme, resolveTheme } from "./theme.js"

// K4-7 acceptance: "the theme swap via config proven with ... a class-name assertion."
// K4-7 round 2: every real @rackbops/styles theme is now genuinely loadable, lazily -- see
// theme.ts's own module docstring for why (bundle-size measurements, the lookup-table
// design, and why import.meta.glob doesn't apply to this package's export shape).

let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  warnSpy.mockRestore()
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

test("resolveTheme honors any real theme name, not just the default", () => {
  expect(resolveTheme({ VITE_KENZEN_THEME: DEFAULT_THEME })).toBe(DEFAULT_THEME)
  expect(resolveTheme({ VITE_KENZEN_THEME: "rackbops-studio" })).toBe("rackbops-studio")
  expect(resolveTheme({ VITE_KENZEN_THEME: "mono-field" })).toBe("mono-field")
  expect(warnSpy).not.toHaveBeenCalled()
})

test("resolveTheme falls back (with a warning) for a name that isn't a real theme", () => {
  expect(resolveTheme({ VITE_KENZEN_THEME: "not-a-real-theme" })).toBe(DEFAULT_THEME)
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("not-a-real-theme"))
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(DEFAULT_THEME))
})

test("AVAILABLE_THEMES lists every theme @rackbops/styles ships", () => {
  expect(AVAILABLE_THEMES).toEqual([
    "arcane-obsidian",
    "arcane-parchment",
    "rackbops-studio",
    "rackbops-noir",
    "luminous-precision",
    "neon-butterfly",
    "summer-cloud",
    "concrete-signal",
    "concrete-signal-light",
    "amber-hearth",
    "amber-ember",
    "mono-field",
  ])
})

test("loadTheme resolves for every available theme", async () => {
  for (const theme of AVAILABLE_THEMES) {
    await expect(loadTheme(theme)).resolves.toBeUndefined()
  }
})

test("loadTheme rejects a name that isn't a real theme", async () => {
  await expect(loadTheme("not-a-real-theme")).rejects.toThrow(/not-a-real-theme/)
})

test("applyTheme sets data-rb-style on the given root to the resolved theme, and a different config swaps it", () => {
  const root = document.createElement("html")
  applyTheme(resolveTheme({}), root)
  expect(root.dataset.rbStyle).toBe("arcane-obsidian")

  applyTheme(resolveTheme({ VITE_KENZEN_THEME: "rackbops-studio" }), root)
  expect(root.dataset.rbStyle).toBe("rackbops-studio")
  expect(root.getAttribute("data-rb-style")).toBe("rackbops-studio")
})
