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
  },
})
