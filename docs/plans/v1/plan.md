# Kenzen 1.0 -- delivery plan

Status: **draft for audit** (2026-09-08). Companion to [`design.md`](design.md). Epic: [Tooling#473](https://github.com/Rackbops/Tooling/issues/473); the build placeholder there is [Tooling#478](https://github.com/Rackbops/Tooling/issues/478), which this plan splits into the children below. Every child becomes one issue in `Rackbops/kenzen`, in the order listed, in the epic-flow shape; dependencies are stated in prose in each issue's body, never as GitHub dependency links.

## Ground rules

- **The review gate runs per PR**: two read-only adversarial reviewers plus self-run mutation testing on any behaviour change; the doc-only single-audit lane for docs. Acceptance bullets are executed, output pasted.
- **Ratchet early.** The image ratchet (K4-6) and the contract ratchet (K4-4) land before the first UI feature.
- **Reuse first, give back.** Every child names what it consumes from `design.md` §8; anything generic it builds is filed for its shared home per §9 before the epic closes.
- **Sizes** use the org `effort` ladder (XS hours, S a day, M 2-3 days, L a week -- split). Nothing here is L.
- **CI on the disposable pool from the first workflow** (private repo). Never `ubuntu-latest` for a job that runs on every PR.
- **No silent upgrades.** Kenzen records decisions; it never opens, approves or merges anything.

## Milestones

| Milestone | Children | Exit criterion |
|---|---|---|
| **M0 Foundations** | K4-1 scaffold · K4-2 server skeleton · K4-3 SQLite + migrations · K4-4 ingest + contract ratchet · K4-6 image + ratchet + release | The real image boots empty on the `docker` slot, `/healthz` and the contract ratchet are green, and a real Tooling snapshot ingests locally |
| **M1 Decisions** | K4-5 decisions API | `GET /api/decisions` returns a shape `software_digest.py` consumes; a `PUT` round-trips with audit history |
| **M2 The page** | K4-7 UI shell · K4-8a needs-a-decision + repo tables · K4-8b decided + Dependabot + history + soundness line · K4-9 decision actions | The dashboard renders a real snapshot with all five sections and a skip made on the page suppresses the item in the next `software_digest.py --dry-run` |
| **Live** | Tooling#479 (deploy on nucbox) · Tooling#477 (Tooling publishes, digest reads back) · Tooling#480 (close the loop) | Epic #473's exit criterion |

Critical path: K4-1 → K4-2 → K4-3 → K4-4 → K4-5 → K4-7 → K4-8a → K4-9 → #479. K4-6 runs parallel to K4-3/K4-4 once K4-2 is in; K4-8b parallel to K4-9.

---

## Children (filed in `Rackbops/kenzen`)

### K4-1 -- Repo scaffold: pnpm workspace, TypeScript strict, Biome, Vitest, house docs, CI on the pool (S)

`packages/server`, `packages/web`, `packages/contract`; `.nvmrc` = 24; `tsconfig.base.json`, `biome.json` copied from artifact-console; `pnpm -r typecheck && pnpm -r test` green on an empty workspace; `CLAUDE.md` (repo-specific only, the personal file governs how) and `CONTEXT.md` per Tooling's scaffold doc §3; a `Justfile` with `check`; `.github/workflows/test.yml` on `[self-hosted, disposable]` with the hygiene test guarding the fork guard on `push-notify.yml` and the explicit (non-`inherit`) secret. Prerequisites: none. Acceptance: fresh clone `pnpm install && pnpm -r typecheck && pnpm -r test` pasted; CI run's job labels show `self-hosted,disposable`.

### K4-2 -- Server skeleton: Hono serving `/healthz` and the SPA, config resolution, logging (S)

Hono + `@hono/node-server` on port 8686; `/healthz` → `{ok:true, version, apiVersion:1}` with `version` from `packages/server/package.json`; config resolution per the app-config standard (`KENZEN_CONFIG_DIR` absolute-only, answer file parsed with `smol-toml` as AC 2.0 does, config path logged at boot, refuses to start only when config is absent everywhere); structured JSON logging to stdout. Prerequisites: K4-1. Acceptance: `curl :8686/healthz` pasted; boot log line naming the config path; a relative `KENZEN_CONFIG_DIR` rejected with a clear error.

### K4-3 -- SQLite state on a volume with boot-time migrations (M)

`node:sqlite` at `<KENZEN_STATE_DIR|/state>/kenzen.db`; `migrate.ts` copied from artifact-console with its `PRAGMA user_version` contract and the migrations README copied verbatim; `0001_init.sql`: `snapshots(id, generatedAt UNIQUE, inventoryItems, summary_json, ingestedAt)`, `items(snapshotId, key, repo, kind, name, pinned, pinStyle, role, source, resolver, latest, latestInMajor, gap, advisoryStatus, advisories_json, assumed, note)` with `(snapshotId, key)` unique and an index on `key`, `repos(snapshotId, repo, dependabot_json, soundness_json)`, `decisions(key PRIMARY KEY, repo, kind, name, source, skippedVersion, remindAt, approvedVersion, acknowledged_json, updatedAt, updatedBy)`, `decision_history(id, key, before_json, after_json, at, by)`. Prerequisites: K4-2. Acceptance: second boot applies zero migrations and reports the schema version; a duplicate migration number is a hard boot error (test); schema pasted from `sqlite3 .schema`.

### K4-4 -- Ingest API + the contract ratchet (M)

`POST /api/ingest` per design §4.2: bearer token from `KENZEN_INGEST_TOKEN` (constant-time compare), `ajv` validation against `packages/contract/schemas/software-inventory.schema.json` and `software-report.schema.json` (authored here from the real files, then **moved to Tooling as the source of truth in Tooling#477** and vendored back byte-identically via `shared-helpers-manifest.json`), idempotent on `generatedAt`, one transaction per snapshot; `GET /api/snapshots`, `GET /api/snapshots/:id/items` with the filters, `GET /api/items/:key/history`, `GET /api/repos`. **Contract ratchet:** committed fixtures `fixtures/software-inventory.sample.json` and `fixtures/software-report.sample.json` taken verbatim from Tooling's real outputs on the day, a test that they validate and ingest, and a test that a field rename in the schema fails the fixture (the mutation the ratchet exists for). Prerequisites: K4-3. Acceptance: Tooling's real current files ingested locally via `curl`, then `GET /api/repos` shows 26 repos and the bot's `cloudflare/cloudflared` item with its two historical advisories; a second identical POST returns 200 with the same `snapshotId`; wrong token → 401; schema violation → 422 naming the path.

### K4-5 -- Decisions API with the bot's semantics and an audit trail (M)

`GET /api/decisions` in the `software_digest.py`-consumable shape (design §4.3); `PUT /api/decisions/:key` with exactly one of the four fields or `clear`; validation (`remindAt` ISO-8601 UTC in the future; a version string for the version fields; advisory ids must exist on the item); `updatedBy` from the Access JWT identity (K4-2's middleware verifies `Cf-Access-Jwt-Assertion`; in local dev a `KENZEN_DEV_IDENTITY` env stands in and is refused when a JWT is present); every change appends to `decision_history`; the suppression rules from design §5 implemented once as pure functions (`suppressionState(item, decision, now)`) and table-tested against the bot's `decidePluginUpdates` cases. Prerequisites: K4-4. Acceptance: a skip, a remind, an approve and an acknowledge each round-trip and appear in `GET /api/decisions`; the table test enumerates newer/equal/older targets for each field; `software_digest.py --dry-run --json` run against `GET /api/decisions` output (Tooling side, read-only) suppresses the skipped item.

### K4-6 -- Dockerfile, compose example, image ratchet, release to ghcr (M)

Multi-stage Dockerfile (build web, build server, runtime `node:24-alpine` with `migrations/` copied beside `dist/`); `compose.yaml.example` + `.env.example` in the deploy-template `node-app` shape (no host port, `state` volume, cloudflared sidecar behind a `tunnel` profile); `image-ratchet.yml` on `[self-hosted, docker]`: build the real image, boot with empty config, assert `/healthz` and the SPA (`scripts/assert-image.mjs` copied from AC 2.0); `release.yml` on `v*`: multi-arch to `ghcr.io/rackbops/kenzen:{version,latest}`, version pinned to `packages/server/package.json` by a test. Prerequisites: K4-2 (runs parallel to K4-3/K4-4). Acceptance: a ratchet run green with the job on a `disposable-nitro-1-*` docker runner; a `v0.1.0-alpha.1` tag publishes a pullable image; `docker history` shows no secret layer.

### K4-7 -- UI shell: React 19 + react-router, `@rackbops/styles` theme, layout and nav (M)

Vite SPA in `packages/web`, built into `packages/server/public/`; theme imported once at the root (`arcane-obsidian` as the other apps, switchable by config); `NavLink`/`Card`/`Button` from `@rackbops/ui-react`; routes for the five sections; a data-fetching layer over the read API with `apiVersion` checking; the scaffold doc's frontend test-config unit (§6) and its "same-named-but-different exports" check (§7). Prerequisites: K4-2. Acceptance: `pnpm build` produces the SPA the server serves at `/`; a Vitest render test per route; the theme swap via config proven with a screenshot pair or class-name assertion.

### K4-8a -- Needs-a-decision and per-repo tables (M)

Sections 1 and 2 of design §6 on real snapshot data: the `DataTable` component (sortable, grouped by role, sticky header, `rb-*` classes only) built here **as a give-back candidate**, source links to GitHub `blob/main/<path>#L<line>`, advisory links, floating-major two-column display, repo/kind/role/status filters. Prerequisites: K4-7, K4-4. Acceptance: the bot's cloudflared row renders with its historical-only advisories; research-triage's runtime-only view shows `node:22-alpine` (final stage) and not the build stages; filters proven by render tests.

### K4-8b -- Decided, Dependabot read-back, history, and the soundness line (M)

Sections 3-5 of design §6: the decided table with who/when and *clear*; the Dependabot section from `repos[*].dependabotAlerts`; per-item history (`/api/items/:key/history`) and per-repo soundness line over snapshots; the `Tabstrip` component (give-back candidate). Prerequisites: K4-7, K4-5. Acceptance: with two ingested snapshots differing in one pin, the history view shows the change; the soundness line's counts match a hand computation on the fixture; "not enabled" renders for a repo with alerts off.

### K4-9 -- Decision actions in the page (M)

Inline skip / remind (date picker with presets 7/30/90 days) / approve / acknowledge on sections 1-2, one-line confirm, optimistic update with rollback on error, identity shown from the Access JWT. Prerequisites: K4-8a, K4-5. Acceptance: a skip made on the page appears in `GET /api/decisions` and, run against a local Tooling checkout, suppresses the item in `software_digest.py --dry-run --json`; an unauthenticated write (no JWT, no dev identity) is refused.

### K4-10 -- Give-back: `DataTable` and `Tabstrip` to `rackbops-ui-ux-std-lib` (M)

After K4-8b: extract both components to the design system with stories in its showcase, publish, and switch Kenzen to the published versions. Prerequisites: K4-8b. Acceptance: the design-system release note; Kenzen's `package.json` depends on the published version; its own copies deleted. (Filed in the design-system repo; listed on Tooling#473.)

---

## Verification checklist (executed at each milestone, real output pasted)

- **M0:** `docker run --rm -p 8686:8686 ghcr.io/rackbops/kenzen:<tag>` with an empty config → `/healthz` JSON; `curl -X POST /api/ingest` with Tooling's real two files → 201 with a `snapshotId`; the contract ratchet fails when a schema field is renamed (do it, paste, revert).
- **M1:** a `PUT /api/decisions/<key>` skip; `GET /api/decisions` → the row; `decision_history` has one entry; Tooling's `software_digest.py --dry-run --json` fed that output suppresses the item.
- **M2:** the five sections on a real snapshot; the research-triage role grouping; a skip made in the browser → suppressed in the next dry-run digest.
- **Live (Tooling#479/#477):** `curl -I https://kenzen.rackbops.com/` → Access 302 unauthenticated; the daily task's next run publishes a snapshot whose `generatedAt` shows in `GET /api/snapshots`; a decision made in Kenzen changes the next real Discord digest.

## Issue count

K4-1 S · K4-2 S · K4-3 M · K4-4 M · K4-5 M · K4-6 M · K4-7 M · K4-8a M · K4-8b M · K4-9 M · K4-10 M = **11 children**, none larger than M.
