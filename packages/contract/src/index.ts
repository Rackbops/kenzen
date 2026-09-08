export type { ValidationResult } from "./validate.js"
export { firstErrorPath, validateInventory, validateReport } from "./validate.js"

// Decision-suppression semantics (design.md section 5) live at their own subpath,
// "@kenzen/contract/suppression", not re-exported from here: this barrel transitively pulls
// in validate.ts's eager schema `readFileSync` (keyed off `import.meta.url`), which breaks
// under packages/web's Vite-transformed test/build environment even though the same code
// works fine loaded straight from packages/server's plain-Node vitest. A dedicated subpath
// keeps the pure, portable suppression logic importable from either package without also
// dragging in the Node-fs-only schema-validation code neither web nor suppression.ts itself
// needs.
