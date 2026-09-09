# Kenzen-sei (Kenzen)

健全性 -- the software-soundness dashboard for every repo roshne owns: what software each repo
uses by role, its pinned vs. latest version, any advisory against it, and where a human records
the decision (skip / remind / approve) that Tooling's daily digest then honours. See
[`docs/PURPOSE.md`](docs/PURPOSE.md) for the problem this solves and its non-goals.

## Status

**Live** at [kenzen.rackbops.com](https://kenzen.rackbops.com) (currently `0.1.0-alpha.14`),
behind Cloudflare Access, on nucbox. A `kenzen-deploy.timer` pulls and redeploys
`ghcr.io/rackbops/kenzen:latest` every 5 minutes. Tooling's daily task publishes a real snapshot
to it. See [`Rackbops/Tooling#479`](https://github.com/Rackbops/Tooling/issues/479) for the
deploy runbook and [`Rackbops/Tooling` epic #473](https://github.com/Rackbops/Tooling/issues/473)
(closed) for how it got built.

## Layout

A pnpm workspace (`packages/*`), Node 24, TypeScript end to end:

| Package | What |
|---|---|
| [`packages/contract`](packages/contract) | JSON Schemas (`schemas/`) + fixtures + the ajv validators for the inventory/report data model -- the ingest contract lives here |
| [`packages/server`](packages/server) | Hono server: `/healthz`, `/api/ingest`, `/api/decisions`, SQLite state |
| [`packages/web`](packages/web) | React 19 + react-router SPA, built by Vite into the server's `public/` |

See [`CLAUDE.md`](CLAUDE.md) for the toolchain (Biome, per-package `tsconfig`, the `catalog:`
pins) and [`docs/plans/v1/design.md`](docs/plans/v1/design.md) for the full stack rationale.

## Run locally

```
pnpm install
pnpm run build     # tsc (contract, server) + vite build (web -> packages/server/public)
pnpm test          # pnpm -r test; needs the build above first -- @kenzen/contract's
                    # package.json exports point at its dist/, which only exists post-build
KENZEN_STATE_DIR=<fresh dir> KENZEN_CONFIG_DIR=<fresh dir> KENZEN_INGEST_TOKEN=<any value> \
  node packages/server/dist/main.js
```

**Always set `KENZEN_STATE_DIR`/`KENZEN_CONFIG_DIR` to a fresh, explicit directory for any local
run.** With neither set, `@rackbops/node-app-kit` defaults `stateDir` to `/state`, which resolves
on Windows to the *current drive's root* -- shared across every worktree and every boot. See
[`CLAUDE.md`'s Key gotchas](CLAUDE.md#key-gotchas) (kenzen#72) for the full mechanism.

## Theme

The default theme is Kenzen-sei's own brand pair, `kenzen-cyberhealth` (light) / `kenzen-midnight`
(dark) -- built for this app specifically
([rackbops-ui-ux-std-lib#158](https://github.com/Rackbops/rackbops-ui-ux-std-lib/issues/158)),
adopted in [kenzen#91](https://github.com/Rackbops/kenzen/issues/91). STANDARD.md section 15's
"pick by kind, not by taste" rule reads naturally as a rule for choosing among the library's
*generic* themes (a console defaults to `arcane-obsidian`, a public-facing app to
`rackbops-studio`); this reading isn't spelled out as a carve-out in STANDARD.md itself, so treat
it as this app's own interpretation, not a documented exception. Under it, this pair doesn't need
a by-kind justification -- it's Kenzen's own commissioned identity, not a borrowed library theme --
but the "why" an opt-in pick requires is still owed here in prose, which is what this section is.

`VITE_KENZEN_THEME` picks the deployment default at build time (`theme.ts`'s `DEFAULT_THEME`
constant when nothing overrides it -- no `Dockerfile`/compose/deploy site currently sets the env
var itself, so the code constant is the only lever today). The header's `Theme` picker lets a
viewer override it for their own browser (`localStorage`, no server round trip), listing the
Kenzen pair first (light, then dark) and every other bundled theme alphabetically after. (The
picker is [kenzen#82](https://github.com/Rackbops/kenzen/issues/82), merged on `main`; both it and
the new default reach the deployed site with the next alpha -- not yet applied there as of this
PR.)

## Release

Bump `packages/server/package.json`'s version via PR, tag `vX.Y.Z-alpha.N` on the merge commit
(roshne pushes tags), and `release.yml` builds and publishes the multi-arch image to
`ghcr.io/rackbops/kenzen:<version>` and `:latest`.

## Data in

Kenzen never scans. Tooling's `software_inventory.py` / `software_report.py` publish a daily
snapshot to `POST /api/ingest`; `software_digest.py` reads recorded decisions back from
`GET /api/decisions` (falling back to a local file when Kenzen is unreachable). See
[`Rackbops/Tooling`'s `docs/kenzen-pipeline.md`](https://github.com/Rackbops/Tooling/blob/main/docs/kenzen-pipeline.md)
for the full pipeline, secrets, and troubleshooting.

Private repo; not for outside use.
