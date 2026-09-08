// Types for assert-image.mjs (a plain-JS script), so image-assert.test.ts imports it typed --
// the same pattern as Rackbops/artifact-console's scripts/assert-image.d.mts.
export function assertImage(baseUrl: string, fetchImpl?: typeof fetch): Promise<string[]>
