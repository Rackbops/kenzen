import { boot } from "./boot.js"

// The standalone app shell's real entry point (design.md section 12's "app-only" piece).
// Kept as a thin call into boot() -- see boot.tsx for the actual sequence and why it's split
// out this way.
await boot(document.getElementById("root"))
