import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router"
import "./app.css"
import { App } from "./App.js"
import { bootTheme } from "./theme.js"

// The standalone app shell (design.md section 12's "app-only" piece): BrowserRouter at the
// true page root, and the one place the theme is actually applied to the document.
//
// K4-7b (kenzen#24): bootTheme resolves the configured theme, lazily fetches its CSS
// (import.meta.glob loader -- see theme.ts), and applies it -- all awaited BEFORE the app
// renders, so the page never paints unstyled while the chunk loads. window.localStorage
// (kenzen#82) is the viewer's own theme override, checked before VITE_KENZEN_THEME.
await bootTheme(import.meta.env, document.documentElement, window.localStorage)

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
