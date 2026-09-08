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
})
