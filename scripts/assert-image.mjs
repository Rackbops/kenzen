import { fileURLToPath } from "node:url"

// The image half of K4-6's image ratchet (Tooling#478). Given the base URL of a running kenzen
// container, it asserts the packaged image serves what it declares: /healthz returns
// {ok:true, version, apiVersion:1} (design.md section 4.3/10), and the SPA at / serves real HTML
// containing a recognizable marker. Simplified from Rackbops/artifact-console's
// scripts/assert-image.mjs (design.md section 3) -- Kenzen has no plugin host, so there is no
// import map or vendor-specifier ABI to pin here; that check is AC-specific. Driven by
// .github/workflows/image-ratchet.yml against a real container on the `docker` pool; unit-tested
// against fixture servers in packages/server/src/image-assert.test.ts. Uses only global fetch,
// so it runs with plain `node`.

/**
 * @param {string} baseUrl e.g. "http://127.0.0.1:8686"
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string[]>} the paths it verified (for logging)
 */
export async function assertImage(baseUrl, fetchImpl = globalThis.fetch) {
  const base = baseUrl.replace(/\/+$/, "")
  const get = async (path) => {
    const res = await fetchImpl(`${base}${path}`)
    if (!res.ok) {
      throw new Error(`GET ${path} -> ${res.status} (expected 200)`)
    }
    return res
  }

  // 1. /healthz -> {ok: true, version: <string>, apiVersion: 1} (design.md section 4.3's
  //    additive-only health contract -- every real API response carries apiVersion).
  const health = await (await get("/healthz")).json()
  if (health?.ok !== true) {
    throw new Error(`/healthz "ok" is ${JSON.stringify(health?.ok)}, expected true`)
  }
  if (typeof health?.version !== "string") {
    throw new Error(`/healthz "version" is ${typeof health?.version}, expected string`)
  }
  if (health?.apiVersion !== 1) {
    throw new Error(`/healthz "apiVersion" is ${JSON.stringify(health?.apiVersion)}, expected 1`)
  }

  // 2. the SPA at / serves real HTML with a recognizable marker. Today that's the K4-2
  //    placeholder (packages/server/public/index.html); the real React shell (K4-7/K4-8) keeps
  //    the same <title>Kenzen</title>, so this check survives that swap unchanged -- PROVIDED
  //    the real build keeps a static <title> in its source index.html template (kenzen#8 review
  //    round 1, LOW, forward-looking): this check reads the raw fetched HTML with no JS
  //    execution, so a client-side-only title (e.g. react-helmet with no static fallback) would
  //    be invisible here even though the app works fine in a real browser. K4-7/K4-8's own
  //    acceptance should keep a plain <title>Kenzen</title> in the template.
  const rootRes = await get("/")
  const contentType = rootRes.headers.get("content-type") ?? ""
  if (!contentType.includes("text/html")) {
    throw new Error(`/ content-type is ${JSON.stringify(contentType)}, expected text/html`)
  }
  const html = await rootRes.text()
  if (!/<title>\s*Kenzen\s*<\/title>/i.test(html)) {
    throw new Error("/ is missing <title>Kenzen</title> (the SPA shell)")
  }

  return ["/healthz", "/"]
}

// CLI: node scripts/assert-image.mjs <baseUrl>
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baseUrl = process.argv[2]
  if (!baseUrl) {
    console.error("usage: node scripts/assert-image.mjs <baseUrl>")
    process.exit(2)
  }
  assertImage(baseUrl)
    .then((checked) =>
      console.log(`image ratchet OK: verified ${checked.length} responses (${checked.join(", ")})`),
    )
    .catch((err) => {
      console.error(`image ratchet FAILED: ${err.message}`)
      process.exit(1)
    })
}
