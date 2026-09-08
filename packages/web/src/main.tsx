import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router"
import { App } from "./App.js"
import { applyTheme, resolveTheme } from "./theme.js"

// The standalone app shell (design.md section 12's "app-only" piece): BrowserRouter at the
// true page root, and the one place the theme is actually applied to the document.
applyTheme(resolveTheme(import.meta.env), document.documentElement)

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
