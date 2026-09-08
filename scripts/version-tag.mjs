import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Reconciles the git release tag with the source-of-truth version in
// packages/server/package.json (version.ts:getVersion() reads that same file for /healthz).
// Copied from Rackbops/artifact-console's scripts/version-tag.mjs (design.md section 3):
// the manifest version must normalise to the v<version> tag, or they silently drift.
// release.yml calls the CLI to derive+verify the image version;
// packages/server/src/version-tag.test.ts unit-tests resolveVersion. Node builtins only, so it
// runs with plain `node`.

/**
 * Verify a release tag matches the package version, and return the version to tag the image with.
 * Exact string compare after stripping the leading `v` — preserves a `-alpha.1` pre-release without
 * a semver dependency.
 * @param {string} tag e.g. "v0.1.0-alpha.1"
 * @param {string} pkgVersion e.g. "0.1.0-alpha.1"
 * @returns {string} the verified version (=== pkgVersion)
 */
export function resolveVersion(tag, pkgVersion) {
  if (!/^v\d/.test(tag)) {
    throw new Error(`release tag "${tag}" must be a v-prefixed version, e.g. v0.1.0-alpha.1`)
  }
  const fromTag = tag.slice(1) // strip the leading v
  if (fromTag !== pkgVersion) {
    throw new Error(
      `tag/version mismatch: tag "${tag}" implies "${fromTag}", but ` +
        `packages/server/package.json is "${pkgVersion}". Bump the package version to match ` +
        `the tag (or tag v${pkgVersion}).`,
    )
  }
  return pkgVersion
}

/** The version field of packages/server/package.json, resolved relative to this script. */
export function serverVersion() {
  const url = new URL("../packages/server/package.json", import.meta.url)
  return JSON.parse(readFileSync(url, "utf8")).version
}

// CLI: node scripts/version-tag.mjs <tag>  -> prints the verified version, exits non-zero on mismatch
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2]
  if (!tag) {
    console.error("usage: node scripts/version-tag.mjs <tag>")
    process.exit(2)
  }
  try {
    process.stdout.write(resolveVersion(tag, serverVersion()))
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
