import { Field, Label, Select, Tabstrip, type TabstripTab } from "@rackbops/ui-react"
import { useState } from "react"
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router"
import { Decided } from "./routes/Decided.js"
import { Dependabot } from "./routes/Dependabot.js"
import { History } from "./routes/History.js"
import { NeedsDecision } from "./routes/NeedsDecision.js"
import { Repos } from "./routes/Repos.js"
import { BUNDLED_THEMES, resolveTheme, setTheme } from "./theme.js"

/** The five top-level views (design.md section 6), in the order the strip shows them. `id`
 * doubles as the route path each Route below mounts at, and as the absolute path `onSelect`
 * navigates to. */
const TABS: TabstripTab[] = [
  { id: "needs-decision", label: "Needs a decision" },
  { id: "repos", label: "Repos" },
  { id: "decided", label: "Decided" },
  { id: "dependabot", label: "Dependabot" },
  { id: "history", label: "History" },
]

/**
 * The routed content tree for design.md section 6's five sections, now with the app shell
 * (kenzen#60): a header row (wordmark + top-level view nav) above a max-width main column,
 * both app-local layout (`app.css`'s `kz-*` classes) -- design.md section 12's "app-only"
 * shell piece, same boundary as main.tsx's BrowserRouter/theme application.
 *
 * Top-level nav is `Tabstrip` (`@rackbops/ui-react`), not a row of links -- STANDARD.md
 * section 5.1 documents `rb-tabstrip` as "top-level view nav (bordered pill buttons)", and
 * `Decided.tsx` already uses it for its own sub-view strip. `selected` is read from the
 * current route's top-level segment; `onSelect` navigates to the chosen tab's absolute path.
 *
 * A real `<a href>` per tab is deliberately not layered in, per the issue's own call ("if
 * cheap" -- `Tabstrip`'s actual implementation renders plain `<button>`s, so wrapping each in
 * a real anchor on top would not be cheap). This is a genuine tradeoff, not a strict
 * improvement over the old `NavLink`-per-item nav: right-click, middle-click-to-open-in-a-
 * new-tab, and hover-preview are traded away for Tabstrip's ARIA tablist contract (single tab
 * stop, roving tabindex, arrow-key navigation, a live `aria-selected` on the current view).
 */
export function App() {
  const location = useLocation()
  const navigate = useNavigate()
  // location.pathname.slice(1) alone breaks on a trailing slash (e.g. a bookmarked
  // "/decided/"): react-router's own path matching treats it as equivalent to "/decided" and
  // renders the route correctly, but the naive slice computes "decided/", which matches no
  // TABS id -- the visible route and the highlighted tab silently disagree. Splitting on "/"
  // and taking the first non-empty segment is robust to a trailing slash, a bare "/" (empty
  // array), and any hypothetical nested segment under one of these five routes.
  const selected = location.pathname.split("/").filter(Boolean)[0] ?? ""

  // kenzen#82: a per-browser viewer preference, not decision state -- nothing goes to the
  // server. Seeded from resolveTheme rather than read off the DOM: main.tsx's bootTheme
  // already applied this same resolved value to document.documentElement before React ever
  // mounted, so the two agree by construction, and computing it here (a pure function of
  // env + localStorage) keeps this component testable without depending on bootTheme having
  // run first.
  const [theme, setThemeState] = useState(() => resolveTheme(import.meta.env, window.localStorage))

  async function handleThemeChange(next: string) {
    await setTheme(next, document.documentElement, window.localStorage)
    setThemeState(next)
  }

  return (
    <>
      <header className="kz-header">
        <h1 className="rb-wordmark">
          <span className="rb-wordmark__spark" aria-hidden="true">
            &#9670;
          </span>
          kenzen
        </h1>
        <div className="kz-header__theme">
          <Tabstrip
            label="View"
            selected={selected}
            onSelect={(id) => navigate(`/${id}`)}
            tabs={TABS}
          />
          <Field>
            <Label htmlFor="theme-picker">Theme</Label>
            <Select
              id="theme-picker"
              value={theme}
              onChange={(e) => {
                void handleThemeChange(e.target.value)
              }}
            >
              {BUNDLED_THEMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </header>
      <main className="kz-main">
        <Routes>
          {/* K4-7 review round 1, MEDIUM, live-verified: rendering <NeedsDecision/> directly
              at the index route (instead of redirecting to its own path) meant landing on /
              -- the app's natural URL -- showed real content with no tab marked selected,
              since `selected` (the pathname's segment) is "" at "/", matching no tab id. A
              real redirect makes the URL (and therefore `selected`) consistent regardless of
              which of the two paths a visitor actually lands on. */}
          <Route index element={<Navigate to="needs-decision" replace />} />
          <Route path="needs-decision" element={<NeedsDecision />} />
          <Route path="repos" element={<Repos />} />
          <Route path="decided" element={<Decided />} />
          <Route path="dependabot" element={<Dependabot />} />
          <Route path="history" element={<History />} />
        </Routes>
      </main>
    </>
  )
}
