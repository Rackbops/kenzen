# kenzen -- Claude Instructions

Kenzen-sei (Kenzen) is the software-soundness dashboard for every repo roshne owns, as its own
app: it shows what software each repo uses by role, its pinned vs. latest version, and any
advisory against it, and it's where a human records the decision (skip / remind / approve)
that the daily digest then honours. It replaces the interim Markdown page from
[`Rackbops/Tooling#427`](https://github.com/Rackbops/Tooling/issues/427). See
[`docs/PURPOSE.md`](docs/PURPOSE.md) for the problem and non-goals, and
[`docs/plans/v1/design.md`](docs/plans/v1/design.md) + [`plan.md`](docs/plans/v1/plan.md) for
the stack, data contract, and build order -- tracked under
[`Rackbops/Tooling` epic #473](https://github.com/Rackbops/Tooling/issues/473).

My personal `~/.claude/CLAUDE.md` governs *how I work* -- the review gate, escalation, git &
shipping, commit mechanics, search-tool routing, shell choice, and the **Code style** baseline.
It is **not restated here**; this file covers only what is specific to this repo.

**Commit convention:** Conventional Commits (`feat`, `fix`, `docs`, `chore`, `ci`, `test`).
Scope names the package or area touched (`server`, `web`, `contract`, `ci`, `plans`).

## Layout

A pnpm workspace, Node 24, TypeScript end to end -- the same stack choices as
`Rackbops/artifact-console` 2.0 (design.md section 3), so a later port to an artifact-console
plugin (Tooling#482) would be re-hosting rather than rewriting. All three packages are
scaffolded now (Tooling#478 K4-1) and filled in their own child issue:

| Path | Package | What | Lands in |
|---|---|---|---|
| `packages/server` | `@kenzen/server` | Hono server, SQLite migrations, ingest, decisions API | K4-2 through K4-5 |
| `packages/web` | `@kenzen/web` | React 19 + react-router SPA, built by Vite into the server's `public/` | K4-7, K4-8 |
| `packages/contract` | `@kenzen/contract` | JSON Schemas + shared TS types for the inventory/report/decision model, vendored byte-identically from `Rackbops/Tooling` | K4-4 |

## Toolchain

- `just check` (or `pnpm run check`) = Biome, then `pnpm -r typecheck`, then `pnpm -r test` --
  the same gate CI runs.
- Each package's `tsconfig.json` extends the root `tsconfig.base.json` (strict, `nodenext`).
  A relative import needs its `.js` extension (nodenext resolution), even though the source
  file is `.ts`.
- Shared dev-dependency versions (`typescript`, `vitest`, `@types/node`) are pinned once in
  `pnpm-workspace.yaml`'s `catalog:` and referenced as `catalog:` per package.
- CI (`test.yml`) runs on the org's disposable self-hosted pool -- this repo is private, so
  that's permitted (Tooling#437). `push-notify.yml` carries an explicit fork guard
  (`if: github.repository == 'Rackbops/kenzen'`) and passes `DISCORD_PUSH_WEBHOOK` explicitly,
  never via `secrets: inherit` (Tooling#310) -- both guarded by
  `packages/server/src/ci-hygiene.test.ts`.

## Key gotchas

- **`Rackbops` is a FREE org: a private repo cannot read an org-level secret via
  `secrets: inherit`** -- it resolves the name but passes an empty string, silently shadowing a
  working repo-level secret. Always pass secrets explicitly to a reusable workflow here.
- **`dist/` is generated and gitignored; `pnpm-lock.yaml` is generated and committed** (CI
  installs `--frozen-lockfile`).
