import { cx } from "@rackbops/ui-react"
import type { ReactNode } from "react"
import { Navigate, Route, NavLink as RouterNavLink, Routes } from "react-router"
import { Decided } from "./routes/Decided.js"
import { Dependabot } from "./routes/Dependabot.js"
import { History } from "./routes/History.js"
import { NeedsDecision } from "./routes/NeedsDecision.js"
import { Repos } from "./routes/Repos.js"

/**
 * The routed content tree for design.md section 6's five sections. Relative route/link paths
 * throughout (never a leading `/`) so this tree stays mountable under a router prefix later
 * without code changes -- design.md section 12: "the UI as a router-mounted React tree with
 * no global shell assumptions, so a port is re-hosting." The standalone top-level shell
 * (BrowserRouter, theme application) is boot.tsx's job (called from main.tsx), not this
 * component's -- that's the one piece design.md section 12 calls out as app-only.
 *
 * `NavLink` here is deliberately react-router's own, not `@rackbops/ui-react`'s -- Tooling
 * docs/non-addon-repo-scaffold.md section 7's own documented trap: the design system's
 * `NavLink` is a styled `<a>` with a caller-supplied `active` prop, not a navigation-aware
 * component, so using it directly would silently produce dead links (a full page reload
 * instead of client-side routing, and no automatic active-route detection). Its CSS classes
 * (`rb-link`/`rb-link--active`) are applied to react-router's `NavLink` instead, via its own
 * `className` render-prop, keeping the real navigation behavior and the intended styling.
 */
export function App() {
  return (
    <div>
      <nav>
        <NavItem to="needs-decision">Needs a decision</NavItem>
        <NavItem to="repos">Repos</NavItem>
        <NavItem to="decided">Decided</NavItem>
        <NavItem to="dependabot">Dependabot</NavItem>
        <NavItem to="history">History</NavItem>
      </nav>
      <main>
        <Routes>
          {/* K4-7 review round 1, MEDIUM, live-verified: rendering <NeedsDecision/> directly
              at the index route (instead of redirecting to its own path) meant landing on /
              -- the app's natural URL -- showed real content with no nav item marked active,
              since the only NavLink points at "needs-decision", never at "". A real redirect
              makes the URL (and therefore the nav's isActive match) consistent regardless of
              which of the two paths a visitor actually lands on. */}
          <Route index element={<Navigate to="needs-decision" replace />} />
          <Route path="needs-decision" element={<NeedsDecision />} />
          <Route path="repos" element={<Repos />} />
          <Route path="decided" element={<Decided />} />
          <Route path="dependabot" element={<Dependabot />} />
          <Route path="history" element={<History />} />
        </Routes>
      </main>
    </div>
  )
}

function NavItem({ to, children }: { to: string; children: ReactNode }) {
  return (
    <RouterNavLink
      to={to}
      className={({ isActive }) => cx("rb-link", isActive && "rb-link--active")}
    >
      {children}
    </RouterNavLink>
  )
}
