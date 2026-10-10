import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// Repo-wide CI/infra hygiene (Tooling#478 K4-1), homed here since none of the three
// packages own it more specifically than another. Reads the real workflow file as text
// rather than taking on a YAML-parser dependency for one check -- a lightweight guard
// against a regressed fork guard, a `secrets: inherit` reintroduction, or a dropped
// disposable-runner input, all of which have real incidents behind them (Tooling#310,
// Tooling#437).
// Strips `#`-comments before matching -- both workflow files document, in prose, exactly
// the mistakes these checks guard against (e.g. "never via `secrets: inherit`"), so
// matching the raw text would false-positive on the comment explaining why NOT to do the
// thing. Neither file uses a literal `#` inside a quoted value, so a per-line strip is
// safe here without a real YAML parser.
function code(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => line.replace(/#.*/, ""))
    .join("\n")
}

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))
const pushNotify = code(readFileSync(`${repoRoot}.github/workflows/push-notify.yml`, "utf-8"))
const testWorkflow = code(readFileSync(`${repoRoot}.github/workflows/test.yml`, "utf-8"))
const imageRatchet = code(readFileSync(`${repoRoot}.github/workflows/image-ratchet.yml`, "utf-8"))
const release = code(readFileSync(`${repoRoot}.github/workflows/release.yml`, "utf-8"))
const dockerfile = code(readFileSync(`${repoRoot}Dockerfile`, "utf-8"))
const compose = code(readFileSync(`${repoRoot}deploy/compose.yaml.example`, "utf-8"))

/** Every `image:` value in a compose text, in file order. */
function images(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*image:\s*["']?([^"'\s]+)/gm)].map((m) => m[1] ?? "")
}

/** Why an image reference breaks the pin rule (Rackbops/Tooling#902), or null when it is pinned. */
function pinProblem(ref: string): string | null {
  const name = ref.split("@")[0] ?? ""
  const colon = name.indexOf(":", name.lastIndexOf("/") + 1) // a host:port/ registry is not a tag
  if (colon === -1) return "untagged"
  if (name.slice(colon + 1) === "latest") return "floats on :latest"
  return null
}

describe("push-notify.yml hygiene", () => {
  it("guards against running on a fork", () => {
    expect(pushNotify).toMatch(/if:\s*github\.repository\s*==\s*['"]Rackbops\/kenzen['"]/)
  })

  it("passes the Discord webhook secret explicitly, never via secrets: inherit", () => {
    expect(pushNotify).not.toMatch(/secrets:\s*inherit/)
    expect(pushNotify).toMatch(
      /DISCORD_PUSH_WEBHOOK:\s*\$\{\{\s*secrets\.DISCORD_PUSH_WEBHOOK\s*\}\}/,
    )
  })

  it("runs the reusable workflow on the disposable pool, never hosted minutes", () => {
    expect(pushNotify).toMatch(/runner:\s*'\["self-hosted","disposable"\]'/)
  })
})

describe("test.yml hygiene", () => {
  it("runs on GitHub-hosted ubuntu-latest, never a self-hosted runner", () => {
    // Inverted from the private-repo era (was `[self-hosted, disposable]` per Tooling#437):
    // this is a `pull_request` workflow, so once the repo is public a fork PR runs arbitrary
    // code in this job. A self-hosted runner under that trigger hands your infra to any
    // stranger who opens a PR -- GitHub-hosted is the only safe home. Guards against a revert
    // to the self-hosted pool.
    expect(testWorkflow).toMatch(/runs-on:\s*ubuntu-latest/)
    expect(testWorkflow).not.toMatch(/self-hosted/)
  })
})

describe("image-ratchet.yml hygiene", () => {
  it("runs on GitHub-hosted ubuntu-latest, never a self-hosted runner", () => {
    // Same inversion as test.yml, and sharper here: this `pull_request` job `docker build`s an
    // arbitrary tree, so a self-hosted runner would build and boot a fork's own Dockerfile on
    // your infra. ubuntu-latest ships Docker, so the build/run steps are unchanged.
    expect(imageRatchet).toMatch(/runs-on:\s*ubuntu-latest/)
    expect(imageRatchet).not.toMatch(/self-hosted/)
  })

  it("tears down the ratchet container even when a step fails", () => {
    expect(imageRatchet).toMatch(/name:\s*Teardown[\s\S]*?if:\s*always\(\)/)
  })

  it("boots the ratchet container with a KENZEN_INGEST_TOKEN set", () => {
    // kenzen#8 review round 3, MEDIUM, mutation-tested: K4-4 made this a genuinely required
    // boot-time secret (main.ts's requireIngestToken) -- without it the real image refuses to
    // start at all, which is exactly what broke this PR's own first CI run. Reverting the `-e
    // KENZEN_INGEST_TOKEN=...` flag left the rest of this fast local suite green; only the real,
    // self-hosted-Docker ratchet job would have caught a silent revert without this guard.
    expect(imageRatchet).toMatch(/docker run .*-e\s+KENZEN_INGEST_TOKEN=\S+/)
  })
})

describe("Dockerfile hygiene", () => {
  it("pins the build stage to $BUILDPLATFORM so a cross-platform build never runs the web build under QEMU", () => {
    // kenzen#28 (K4-6b): the deploy bundle is pure JS -- no native modules -- so the build
    // stage (pnpm -r build, esbuild/Vite for the K4-7 web build) only needs to run once, on
    // the builder's own platform. When release.yml still built linux/arm64, that pass ran the
    // whole build stage under QEMU emulation without this pin, which took the v0.1.0-alpha.2
    // run from 4 minutes to over 45. The release is amd64-only now (Rackbops/Tooling#1163), so
    // the pin is a no-op there; it is kept for any cross-platform build. Only the `build` stage
    // is pinned -- `runtime` stays per-target since it's just COPY + adduser, no compilation.
    expect(dockerfile).toMatch(/^FROM --platform=\$BUILDPLATFORM node:26-alpine AS build$/m)
  })

  it("installs pnpm from package.json's packageManager field, not corepack (removed from Node core in 25+)", () => {
    expect(dockerfile).toMatch(
      /npm install -g pnpm@.*require\('\.\/package\.json'\)\.packageManager/,
    )
    expect(dockerfile).not.toMatch(/corepack enable/)
  })
})

describe("deploy/compose.yaml.example hygiene", () => {
  it("pinProblem rejects :latest and untagged references, accepts tags and tag+digest", () => {
    const digest = `sha256:${"0".repeat(64)}`
    expect(pinProblem("cloudflare/cloudflared:latest")).toBe("floats on :latest")
    expect(pinProblem("cloudflare/cloudflared")).toBe("untagged")
    expect(pinProblem("localhost:5000/cloudflared")).toBe("untagged")
    expect(pinProblem(`cloudflare/cloudflared@${digest}`)).toBe("untagged")
    expect(pinProblem("cloudflare/cloudflared:2026.9.3")).toBeNull()
    expect(pinProblem(`cloudflare/cloudflared:2026.9.3@${digest}`)).toBeNull()
  })

  it("pins every image: no :latest, no untagged image (Rackbops/Tooling#902)", () => {
    // `:latest` is one tag shared by every stack on the box: once another stack pulls a newer
    // one, this stack's container runs an image its recorded tag no longer names, and Renovate
    // has no version to bump. On 2026-10-08 kenzen's sidecar showed in `docker ps` only as a bare
    // image ID (cloudflared 2026.9.3, under a `latest` that had moved to 2026.10.0). A variable
    // reference reads here as its literal text; the test below pins which ones may exist.
    const all = images(compose)
    expect(
      all.some((ref) => ref.startsWith("cloudflare/cloudflared")),
      `no cloudflare/cloudflared image line found in ${JSON.stringify(all)}`,
    ).toBe(true)
    for (const ref of all) expect([ref, pinProblem(ref)]).toEqual([ref, null])
  })

  it("allows exactly one variable image: the app's documented `latest` track", () => {
    // The app's own `${IMAGE_TAG:-latest}` is a decision, not drift (Rackbops/Tooling#902,
    // README "Who can deploy"): the release workflow is the deploy. Any OTHER variable image
    // could hide a `:-latest` default, so it fails here instead of passing the literal check.
    expect(images(compose).filter((ref) => ref.includes("${"))).toEqual([
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a compose variable reference, compared as literal text.
      "${IMAGE}:${IMAGE_TAG:-latest}",
    ])
  })
})

describe("release.yml hygiene", () => {
  it("guards against publishing from a fork", () => {
    expect(release).toMatch(/if:\s*github\.repository\s*==\s*['"]Rackbops\/kenzen['"]/)
  })

  it("authenticates to GHCR with the built-in GITHUB_TOKEN, never a PAT", () => {
    expect(release).toMatch(/password:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/)
    expect(release).not.toMatch(/secrets\.[A-Z_]*PAT[A-Z_]*/)
  })

  it("never uses secrets: inherit", () => {
    expect(release).not.toMatch(/secrets:\s*inherit/)
  })

  it("runs on GitHub-hosted ubuntu-latest, never a self-hosted runner", () => {
    // Public repo: the org runner group refuses it, and a self-hosted runner a public repo can
    // reach is an arbitrary-code-execution surface on the box (Rackbops/Tooling#1163).
    expect(release).toMatch(/runs-on:\s*ubuntu-latest/)
    expect(release).not.toMatch(/self-hosted/)
  })

  it("builds linux/amd64 only, with no QEMU step", () => {
    // Rackbops/Tooling#1163: the fleet is x86_64 and nothing pulls an arm64 image; the arm64
    // leg only ran under QEMU. release.yml only runs on a tag or a dispatch, so a revert to a
    // multi-arch build would otherwise stay green.
    expect([...release.matchAll(/platforms:\s*(\S+)/g)].map((m) => m[1])).toEqual(["linux/amd64"])
    expect(release).not.toMatch(/setup-qemu-action/)
    expect(release).not.toMatch(/arm64/)
  })

  it("verifies the tag against packages/server/package.json before publishing", () => {
    expect(release).toMatch(/version-tag\.mjs/)
  })

  it("passes the release tag through env:, never splices it directly into run: script text", () => {
    // kenzen#8 review round 1, MEDIUM: `tag="${{ github.event.inputs.tag || ... }}"` spliced an
    // attacker-shaped workflow_dispatch/tag-push value directly into shell script text -- a
    // classic GH Actions script-injection surface (round 2 confirmed live: a crafted tag breaks
    // out and runs arbitrary commands under that pattern). Guards the fix -- an env: TAG binding
    // referenced only as "$TAG" -- against a future "simplification" reintroducing the direct
    // splice under any variable name. Deliberately does NOT flag `${{ }}` used as a plain YAML
    // action `with:`/`env:` value (e.g. `ref: ${{ ... }}`, `tags: ${{ ... }}`) -- only a shell
    // variable ASSIGNED FROM a template expression, which is what makes it script text.
    expect(release).not.toMatch(/=\s*"\$\{\{/)
    expect(release).toMatch(
      /env:\s*\n\s*TAG:\s*\$\{\{\s*github\.event\.inputs\.tag\s*\|\|\s*github\.ref_name\s*\}\}/,
    )
    expect(release).toMatch(/version-tag\.mjs\s+"\$TAG"/)
  })
})
