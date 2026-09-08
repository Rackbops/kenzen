import { configDefaults, defineConfig } from "vitest/config"

// See packages/server/vitest.config.ts for the full explanation: vitest 4 narrowed its default
// `test.exclude` to just node_modules/.git, so without this it also runs the tsc-compiled
// dist/*.test.js files as duplicate suites alongside src/*.test.ts. This package's dist tests
// happen not to fail on it (no filesystem-relative fixture resolution), but running every test
// twice is still pure waste -- restore the old default so tests run only from source.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
})
