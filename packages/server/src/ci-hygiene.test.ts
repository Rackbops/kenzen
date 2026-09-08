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
  it("runs on the org disposable pool, never GitHub-hosted minutes", () => {
    expect(testWorkflow).toMatch(/runs-on:\s*\[self-hosted,\s*disposable\]/)
  })
})

describe("image-ratchet.yml hygiene", () => {
  it("runs on the docker DinD slot, not the plain disposable lint pool", () => {
    expect(imageRatchet).toMatch(/runs-on:\s*\[self-hosted,\s*docker\]/)
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
  it("pins the build stage to $BUILDPLATFORM so the multi-arch release doesn't run the web build under QEMU", () => {
    // kenzen#28 (K4-6b): the deploy bundle is pure JS -- no native modules -- so the build
    // stage (pnpm -r build, esbuild/Vite for the K4-7 web build) only needs to run once, on
    // the builder's own platform. Without this pin, buildx's linux/arm64 pass runs the whole
    // build stage under QEMU emulation, which took release.yml's v0.1.0-alpha.2 run from 4
    // minutes to over 45. Only the `build` stage is pinned -- `runtime` stays per-target since
    // it's just COPY + adduser, no compilation.
    expect(dockerfile).toMatch(/^FROM --platform=\$BUILDPLATFORM node:24-alpine AS build$/m)
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
