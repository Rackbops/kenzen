import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The Kenzen SPA (K4-7, design.md section 3): a standard bundled Vite React build, built
// straight into the server's own public/ -- unlike Rackbops/artifact-console's ui-shell,
// there is no plugin host here (design.md section 12 defers that), so there is no import-map/
// shared-singleton vendor build to coordinate with.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../server/public",
    // Live-verified: Vite's own default only auto-empties an outDir INSIDE the current
    // package root -- "../server/public" is outside packages/web/, so without this the build
    // warns "will not be emptied" and silently leaves every previous build's stale hashed
    // assets/*.js/*.css sitting in public/ forever, growing the image and shipping dead code.
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
    restoreMocks: true,
    // Vitest 4 changed vi.spyOn: re-spying an object property that's already a mock now
    // returns the SAME mock instance instead of a fresh one carrying only the inherited
    // implementation (vitest 3's spyOn created a new spy with empty .mock.calls each time,
    // per @vitest/spy's own `if (isMockFunction(fn)) return fn` fast path added in v4). Every
    // test in this suite re-establishes its spies with `vi.spyOn(...)` fresh, so without this
    // their call counts silently accumulate across the whole file instead of resetting per
    // test -- e.g. Decided.test.tsx's "clear calls the API ... and refetches" asserts
    // `fetchDecisions` was called exactly twice but was actually seeing every prior test's
    // calls to the same never-reset spy. restoreMocks restores the original implementation
    // and clears call history before each test, matching vitest 3's de facto behavior.
  },
})
