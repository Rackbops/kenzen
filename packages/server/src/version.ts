import { readFileSync } from "node:fs"

/**
 * The server's version, read from its own package.json at runtime -- single source of truth
 * for `/healthz`. Copied from `Rackbops/artifact-console`'s `packages/host/src/version.ts`
 * (design.md section 3): resolves the same file from both the Vitest source tree and the
 * compiled `dist/` via `import.meta.url`, so no tsconfig rootDir games.
 */

interface PackageJson {
  version?: string
}

let cached: string | undefined

export function getVersion(): string {
  if (cached !== undefined) {
    return cached
  }
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageJson
  cached = pkg.version ?? "0.0.0"
  return cached
}
