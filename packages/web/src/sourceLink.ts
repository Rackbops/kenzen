/**
 * design.md section 6, section 2: "source links to `https://github.com/<repo>/blob/main/<path>#L<line>`".
 * An item's `source` field is `"path:line"` (design.md section 4.1's `source = "path:line"`),
 * `repo` is `"owner/name"` -- both already exactly what the URL needs, just joined differently.
 * Kenzen-specific (the `path:line` format is this app's own data contract), so this stays out
 * of the generic `components/` give-back candidates.
 */
export function sourceUrl(repo: string, source: string): string | null {
  const colonIndex = source.lastIndexOf(":")
  if (colonIndex <= 0 || colonIndex === source.length - 1) {
    return null
  }
  const path = source.slice(0, colonIndex)
  const line = source.slice(colonIndex + 1)
  if (!/^[1-9][0-9]*$/.test(line)) {
    return null
  }
  return `https://github.com/${repo}/blob/main/${path}#L${line}`
}
