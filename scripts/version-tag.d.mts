// Types for version-tag.mjs (a plain-JS script), so version-tag.test.ts imports it typed --
// the same pattern as Rackbops/artifact-console's scripts/version-tag.d.mts.
export function resolveVersion(tag: string, pkgVersion: string): string
export function serverVersion(): string
