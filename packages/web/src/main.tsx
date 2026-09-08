import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router"
import { App } from "./App.js"
import { applyTheme, loadTheme, resolveTheme } from "./theme.js"

// The standalone app shell (design.md section 12's "app-only" piece): BrowserRouter at the
// true page root, and the one place the theme is actually applied to the document.
//
// Theme CSS is loaded lazily (K4-7 round 2) -- await it before mounting so the first paint
// is already themed, the same as a static import would have guaranteed, rather than a brief
// flash of unstyled content while the chunk fetches.
const theme = resolveTheme(import.meta.env)
await loadTheme(theme)
applyTheme(theme, document.documentElement)

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
}
