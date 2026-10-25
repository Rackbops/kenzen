import { readFileSync } from "node:fs"

/**
 * The `readFile` hook handed to `resolveConfig`: `null` means "no config file", so only ENOENT
 * may return it. Any other failure (EACCES from a wrongly-owned mount, EISDIR) must surface, or
 * the server boots on defaults and silently ignores the operator's config (kenzen#150).
 */
export function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
}
