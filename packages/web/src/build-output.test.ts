import { execFileSync } from "node:child_process"
import { readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ASSETS_DIR = path.join(WEB_ROOT, "..", "server", "public", "assets")
const VITE_BIN = path.join(WEB_ROOT, "node_modules", "vite", "bin", "vite.js")

/**
 * kenzen#60's build-output guard: `main.tsx` imports exactly one app-local stylesheet
 * (`app.css`), so a production build must emit exactly one `index-*.css` chunk into the
 * server's `public/assets/` -- two would mean a second entry point or a duplicated import;
 * zero would mean the `app.css` import silently stopped reaching the bundle. Mutation guard:
 * delete `main.tsx`'s `import "./app.css"` line and this assertion fails (0 matches).
 *
 * Runs a REAL `vite build` (not a fixture) -- the thing under test is Vite's own bundling
 * behaviour, which nothing short of a real build exercises. This is the same build
 * `pnpm --filter web build` runs; invoking it directly here means `pnpm test` alone (this
 * package's `test` script) proves the guard without depending on a prior build step.
 */
test("the production build emits exactly one index-*.css asset", () => {
  execFileSync(process.execPath, [VITE_BIN, "build"], { cwd: WEB_ROOT, stdio: "pipe" })
  const cssAssets = readdirSync(ASSETS_DIR).filter((f) => /^index-.*\.css$/.test(f))
  expect(cssAssets).toHaveLength(1)
}, 60_000)
