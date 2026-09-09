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
// renders, so the page never paints unstyled while the chunk loads.
await bootTheme(import.meta.env, document.documentElement)

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
