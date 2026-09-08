import { configDefaults, defineConfig } from "vitest/config"

// Vitest 4 narrowed its default `test.exclude` to just node_modules/.git (previously it also
// excluded dist/build output by default). Without this, vitest picks up the tsc-compiled
// dist/*.test.js files alongside the src/*.test.ts sources and runs both as separate suites.
// That's not just wasted duplicate test runs: dist/app.test.js resolves its SPA fixture
// directory relative to *its own* compiled location (`dirname(fileURLToPath(import.meta.url))`
// in app.test.ts), which lands in dist/__fixtures__/public -- a path that never exists because
// tsc only compiles .ts files and never copies the static __fixtures__/public/* fixtures into
// dist. That 404s "GET / serves the SPA's index.html" under vitest 4 even though the identical
// assertion against src/app.test.ts passes fine. Restoring the old default keeps tests running
// only from source, where the fixture directory actually resolves.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
})
