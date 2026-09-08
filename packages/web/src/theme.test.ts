import { expect, test } from "vitest"
import { applyTheme, DEFAULT_THEME, resolveTheme } from "./theme.js"

// K4-7 acceptance: "the theme swap via config proven with ... a class-name assertion."

test("resolveTheme falls back to arcane-obsidian when unset", () => {
  expect(resolveTheme({})).toBe(DEFAULT_THEME)
  expect(resolveTheme({ VITE_KENZEN_THEME: undefined })).toBe(DEFAULT_THEME)
})

test("resolveTheme falls back on a blank value, matching config.ts's own convention", () => {
  expect(resolveTheme({ VITE_KENZEN_THEME: "" })).toBe(DEFAULT_THEME)
})

test("resolveTheme honors a configured theme", () => {
  expect(resolveTheme({ VITE_KENZEN_THEME: "rackbops-studio" })).toBe("rackbops-studio")
})

test("applyTheme sets data-rb-style on the given root, and a different config swaps it", () => {
  const root = document.createElement("html")
  applyTheme(resolveTheme({}), root)
  expect(root.dataset.rbStyle).toBe("arcane-obsidian")

  applyTheme(resolveTheme({ VITE_KENZEN_THEME: "rackbops-studio" }), root)
  expect(root.dataset.rbStyle).toBe("rackbops-studio")
  expect(root.getAttribute("data-rb-style")).toBe("rackbops-studio")
})
