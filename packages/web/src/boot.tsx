import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router"
import { App } from "./App.js"
import { applyTheme, loadTheme, resolveTheme } from "./theme.js"

/**
 * Resolves + lazily loads the configured theme, then mounts the app shell. Split out of
 * main.tsx (which just calls this once against the real `#root`) so the failure-handling
 * around a rejected `loadTheme` can be unit-tested directly -- main.tsx itself runs its
 * body as a side effect on import, which a test importing it would trigger unwantedly.
 *
 * K4-7 round 2 (HIGH, live-reproduced): a bare `await loadTheme(theme)` with no try/catch
 * meant a genuine failure loading the theme's CSS chunk -- a network blip, or a stale
 * `index.html` referencing a content hash rotated off the server after a redeploy -- threw
 * before `createRoot(...).render(...)` ever ran, blanking the entire app with no content
 * and no way to recover short of a manual reload. Catching it and continuing means the
 * worst case degrades to one unstyled load (matching the graceful-degradation bar every
 * earlier version of this mechanism already met), not a dead page.
 */
export async function boot(root: HTMLElement | null): Promise<void> {
  const theme = resolveTheme(import.meta.env)
  try {
    await loadTheme(theme)
  } catch (err) {
    console.error(`kenzen: failed to load theme "${theme}" -- rendering unstyled this load.`, err)
  }
  applyTheme(theme, document.documentElement)

  if (root) {
    createRoot(root).render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    )
  }
}
