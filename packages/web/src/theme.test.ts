import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { applyTheme, BUNDLED_THEMES, DEFAULT_THEME, resolveTheme } from "./theme.js"

// K4-7 acceptance: "the theme swap via config proven with ... a class-name assertion."
// See theme.ts's own module docstring (K4-7 review round 1, HIGH) for why only
// DEFAULT_THEME is actually bundled today, and why an unbundled configured value falls
// back rather than silently rendering unstyled.

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

test("resolveTheme honors a configured theme that IS bundled", () => {
  expect(resolveTheme({ VITE_KENZEN_THEME: DEFAULT_THEME })).toBe(DEFAULT_THEME)
  expect(warnSpy).not.toHaveBeenCalled()
})

test("resolveTheme falls back (with a warning) for a theme name with no matching CSS bundled", () => {
  // The round-1 bug's real failure mode: a configured-but-unbundled theme used to be applied
  // to the DOM attribute anyway, silently rendering unstyled. Now it fails safe instead.
  expect(resolveTheme({ VITE_KENZEN_THEME: "rackbops-studio" })).toBe(DEFAULT_THEME)
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("rackbops-studio"))
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(DEFAULT_THEME))
})

test("BUNDLED_THEMES lists exactly the theme this module actually imports CSS for", () => {
  expect(BUNDLED_THEMES).toEqual([DEFAULT_THEME])
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
