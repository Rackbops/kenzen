# Kenzen-sei (Kenzen) 1.0 -- design

Status: **audited 2026-09-08** (one independent claims-vs-code pass: 3 findings -- `resolver` absent from the report item, K4-10's filing repo, K4-10 missing from the milestones -- all fixed; 2 minor notes addressed). Epic: [Tooling#473](https://github.com/Rackbops/Tooling/issues/473); this doc is [Tooling#476](https://github.com/Rackbops/Tooling/issues/476). Companion: [`plan.md`](plan.md). Research: Tooling's [`research/software-inventory-and-update-surfacing.md`](https://github.com/Rackbops/Tooling/blob/main/research/software-inventory-and-update-surfacing.md).

Claims below are marked **[code]** (true of something that exists, with a citation), **[decided]** (roshne's call, dated) or **[proposed]** (this doc's design, to be proven by the plan's ratchets).

---

## 1. What Kenzen is

健全性 *kenzen-sei* -- the soundness of a system -- is what this app shows: for every repo we own, what software it uses by role (runtime, test, build, CI, infra), the version pinned, the latest available, and any advisory against the pinned version; and it is where a human records the decision about each finding -- **approve, skip this version, remind me later, acknowledge this advisory** -- so the daily Discord digest stops nagging about things already decided. **Kenzen never changes a repo.** Renovate opens PRs only when a human ticks a dashboard checkbox; nothing auto-merges; Kenzen only records that a human looked. **[decided 2026-09-07]** The no-silent-upgrades constraint of Tooling#420 applies to it in full.

Kenzen is an app of its own, not a plugin of artifact-console 2.0, because a plugin panel could not ship until that project's E3 shell lands. **[decided 2026-09-07]** The choice is re-evaluated when E3 closes ([Tooling#482](https://github.com/Rackbops/Tooling/issues/482)); section 12 keeps that port cheap.

## 2. Shape: Tooling collects, Kenzen shows and decides

```
 dev box (Windows, daily task \ClaudeLocal\ClaudeSoftwareInventory)        nucbox (Docker, behind Cloudflare Access)
 +--------------------------------------------------------------+        +------------------------------------------+
 | software_inventory.py --write  -> software-inventory.json     |        | kenzen (Hono API + React UI, SQLite)     |
 | software_report.py --report    -> software-report.json        | POST   |   POST /api/ingest   (bearer token)      |
 |                    --publish   ------------------------------>|------->|   snapshots + items + repos              |
 | software_digest.py --run-report                              |        |   decisions (skip/remind/approve/ack)    |
 |    GET /api/decisions <-------------------------------------- |<-------|   GET  /api/decisions                    |
 |    -> Discord digest (deltas only)                            |        |   GET  /api/snapshots, /api/items, ...   |
 +--------------------------------------------------------------+        +------------------------------------------+
```

- **Tooling stays the collection engine** **[code]**: `software_inventory.py` (Tooling#424) emits the inventory; `software_report.py` (Tooling#425) resolves latest versions and advisories into the report; `software_digest.py` (Tooling#426, in flight) posts deltas to Discord and honours decisions. All Python, stdlib, scheduled on the dev box. Kenzen re-collects nothing. **[decided 2026-09-08, decision 4]**
- **Kenzen ingests, stores every snapshot, renders, and owns the decision state.** The hand-edited `software-decisions.json` in Tooling becomes the fallback the digest uses when Kenzen is unreachable ([Tooling#477](https://github.com/Rackbops/Tooling/issues/477)).
- **Interim** **[code]**: until Kenzen 1.0 is live, the Python-rendered Markdown page in the artifact-console 1.x store (Tooling PR #486) is the dashboard. Tooling#480 retires or demotes it.

## 3. Stack **[decided 2026-09-08, decision 1]**

TypeScript end to end, the artifact-console 2.0 choices so a later plugin port is re-hosting rather than rewriting:

| Layer | Choice | Precedent **[code]** |
|---|---|---|
| Runtime | Node 24 (`.nvmrc`), pnpm workspace | artifact-console `.nvmrc` = `24`, `pnpm-workspace.yaml` |
| API | Hono + `@hono/node-server`; JSON schema validation with `ajv` | artifact-console `packages/host/package.json` deps: `hono ^4`, `@hono/node-server ^1`, `ajv ^8.17` |
| State | SQLite via `node:sqlite`, numbered `NNNN_name.sql` migrations tracked by `PRAGMA user_version`, append-only and immutable once shipped | artifact-console `packages/host/migrations/README.md` (copied verbatim as Kenzen's contract) |
| UI | React 19 + react-router SPA built by Vite into the server's `public/`; `@rackbops/styles` theme imported once at the root; components from `@rackbops/ui-react` | artifact-console `packages/ui-shell`; `rackbops-ui-ux-std-lib` README "React components" (`Button`, `Card`, `NavLink`; components carry fixed `rb-*` classes and the theme is selected by the `data-rb-style` attribute, so themes stay swappable) |
| Tests / lint | Vitest, Biome, TypeScript strict | artifact-console `biome.json`, `tsconfig.base.json` |
| CI | the org's disposable runner pool (`runs-on: [self-hosted, disposable]`; private repo, so permitted), image ratchet on the `docker` DinD slot | artifact-console `.github/workflows/test.yml`, `image-ratchet.yml` |
| Image | `ghcr.io/rackbops/kenzen`, multi-arch on `v*` tags, version sourced from `package.json` with a tag-pin test | artifact-console `release.yml` |

Why not Python: the UI and deploy conventions of roshne's apps are TypeScript, and the design system is React. Why not a plugin now: section 1.

Layout: `packages/server` (Hono, migrations, ingest, decisions), `packages/web` (React), `packages/contract` (the JSON schemas and TS types shared by both, plus the vendored copies of Tooling's schemas -- section 4).

## 4. The data contract with Tooling

### 4.1 What Tooling emits **[code]**

`software-inventory.json` (Tooling#424, committed at Tooling's root): `{"_comment", "repos": [owned], "readOnly": [forks], "items": [Item]}`, Item = `repo, kind, name, pinned, pinStyle, role, source, resolver` with `kind ∈ {dockerfile-base, compose-image, github-action, npm-dep, pip-dep, runtime-pin}`, `pinStyle ∈ {exact, major, floating}`, `role ∈ {runtime, test, build, ci, infra}`, `source = "path:line"`, `resolver ∈ {dockerhub, ghcr, npm, pypi, gh-release, gh-tag, none}` (`software_inventory.py` `class Item`, lines 40-51 as merged).

`software-report.json` (Tooling#425, written under the out-of-git state dir): `{"generatedAt", "inventoryItems", "items": [ReportItem], "repos": {repo: {"dependabotAlerts": "not enabled" | [...]}}, "summary": {...}}`; ReportItem = the Item fields **except `resolver`** (the report copies `repo, kind, name, pinned, pinStyle, role, source` only -- `software_report.py` lines 1141-1149) plus `key` (`repo|kind|name|source`), `latest`, `latestInMajor`, `gap ∈ {none, patch, minor, major, unknown}`, `advisoryStatus ∈ {affected, historical-only, none, unknown}`, `advisories: [{id, summary, severity, url, source ∈ {osv, ghsa}, affected}]`, `assumed`, `note` (`software_report.py` `build_report`, lines ~1103-1163 as merged).

### 4.2 Ingest **[proposed]**

`POST /api/ingest` -- body `{"apiVersion": 1, "generatedAt", "inventory": <software-inventory.json>, "report": <software-report.json>}`, header `Authorization: Bearer <token>`. Validated with `ajv` against JSON Schemas kept in `packages/contract/schemas/` and **vendored byte-identically from Tooling** (`schemas/software-inventory.schema.json`, `schemas/software-report.schema.json`, published by Tooling#477 and listed in `shared-helpers-manifest.json` so the daily drift watcher alarms if the twins diverge). Idempotent on `generatedAt` (a re-post of the same snapshot is a 200 no-op). Because the body carries both documents, ingest joins them: each stored item is the ReportItem plus `resolver` backfilled from the inventory item with the same `repo|kind|name|source` (an inventory item with no report row is stored with `latest`/`gap`/`advisoryStatus` null and `note = "not in report"`; a report row with no inventory item is a 422, since the report is derived from the inventory). Response `{"apiVersion": 1, "snapshotId", "items", "generatedAt"}`. Every ingest is a snapshot; nothing is overwritten -- history is the point.

The token: generated once, stored on nucbox in the app's `.env` as `KENZEN_INGEST_TOKEN` and on the dev box as `secrets/kenzen.json` (`{"ingestToken": ...}`), read by Tooling via `notify.secrets_path("kenzen.json")`. Never in either repo.

### 4.3 Read API **[proposed]**

All responses carry `apiVersion: 1`; the contract is additive-only (new fields yes, renamed or removed never -- the same rule as AC 2.0's `/healthz`).

- `GET /healthz` -> `{ok, version, apiVersion}` (the image ratchet asserts this).
- `GET /api/snapshots?limit=` -> newest first: `{snapshotId, generatedAt, inventoryItems, summary}`.
- `GET /api/snapshots/:id/items?repo=&kind=&role=&status=` -> ReportItems of that snapshot, joined with the current decision per key.
- `GET /api/items/:key/history` -> the item's `pinned/latest/gap/advisoryStatus` across snapshots (what changed when).
- `GET /api/repos` -> per repo: item counts by role, counts by gap and advisoryStatus, the Dependabot read-back, and the **soundness line** (section 6).
- **`GET /api/decisions`** -> `{"apiVersion": 1, "decisions": [{repo, kind, name, source?, skippedVersion?, remindAt?, approvedVersion?, acknowledgedAdvisories?, updatedAt, updatedBy}]}` -- the shape `software_digest.py` consumes (Tooling#426's `software-decisions.json` rows are exactly `{repo, name, kind?, source?, skippedVersion | remindAt}` **[code]**; Kenzen's superset adds `approvedVersion` and `acknowledgedAdvisories`, which the digest may ignore).
- `PUT /api/decisions/:key` with one of `{skippedVersion} | {remindAt} | {approvedVersion} | {acknowledgedAdvisories: [ids]} | {clear: true}`; `updatedBy` from the Access identity header (section 11).

## 5. The decision model **[proposed, semantics copied]**

Copied from the Discord bot's plugin-update flow, `rackbops-discord-bot/src/plugins/updates.ts` `decidePluginUpdates` **[code]**: a `skippedVersion` is silent until the target is *strictly newer* than it; a `remindAt` is silent until it passes, then surfaces once; a new target resets either. Kenzen adds:

| Field | Meaning | Effect on the digest / the page |
|---|---|---|
| `skippedVersion` | "not this version" | suppressed until `latest` > it (Tooling#426's rule, unchanged) |
| `remindAt` | "later" | suppressed until the instant passes; the page shows it under *Snoozed* with the date |
| `approvedVersion` | "I ticked the Renovate box for this" | suppressed until `pinned` moves (the PR merged) or `latest` passes the approved version; the page shows *Approved -- PR pending* |
| `acknowledgedAdvisories` | "seen this advisory; not actionable for us" (e.g. historical-only, or a dev-only dependency) | that advisory no longer counts toward *affected* on the page; the digest stops listing it |

Decisions are keyed by `repo|kind|name|source` (the report's `key`); a decision made on an item whose `source` line moves (file edited) is re-matched by `repo|kind|name` and the user is shown that it was carried over. Every decision row keeps `updatedAt` and `updatedBy`; a `decision_history` table keeps the previous values (who changed what, when) -- the audit trail the research doc asked for.

## 6. The UI **[proposed]**

Sections, in this order, per repo filters on every table:

1. **Needs a decision** -- items with `advisoryStatus = affected` (advisories not acknowledged) first, then `gap ∈ {major, minor, patch}` without a decision; each row has the four decision actions inline, with a one-line confirm.
2. **Per repo** -- one table per repo, grouped by `role` (runtime, infra, ci, build, test), columns `kind · name · pinned · latest / latestInMajor · gap · advisories · source` (source links to `https://github.com/<repo>/blob/main/<path>#L<line>`; advisory ids link to osv.dev / GitHub); floating-major pins show `latestInMajor` and `latest` side by side (the research doc's "on 2, latest 3.x exists").
3. **Decided** -- skipped, snoozed, approved-pending, with the decision and who/when; a *clear* action.
4. **Dependabot read-back** -- per repo, the transitive alerts Tooling read back (`repos[*].dependabotAlerts`), or "not enabled".
5. **History** -- for any item, its pins and gaps across snapshots; for any repo, the soundness line over time.

**The soundness line** (per repo, and one for the estate): `N items · A affected · G behind (major/minor/patch) · D decided · U unknown`, computed from the latest snapshot minus decisions. Deliberately a count line, not a score -- a single number would invite gaming and hide what matters.

Components: `Card`, `Button`, `NavLink` from `@rackbops/ui-react` as they exist **[code]**; the data table and a tab strip do **not** exist there yet **[code: README lists only those three]**, so Kenzen builds them on the `rb-*` contract and **gives them back** (section 9). No bespoke shell: theme CSS imported once at the root, layout only.

## 7. Deployment **[decided 2026-09-08, decisions 2 + 3]**

- **Host:** nucbox (10 GiB, 8.6 GiB available, no swap pressure, every other fronted app and tunnel already there; nitro carries the monitoring stack and 8 runner slots and is in swap) -- measured 2026-09-08.
- **Hostname:** `kenzen.rackbops.com`, Cloudflare Access in front with the existing two-person policy. A shipped identifier once Access and Uptime Kuma reference it.
- **Shape:** `rackbops-web-deploy-template` `servers/node-app` **[code]** -- a built image plus a per-app cloudflared token-tunnel sidecar in the app's own compose project, **no host port**, managed as a Dockge stack at `/opt/stacks/kenzen/`, with `publish/deploy-pull.sh` on a systemd timer swapping the container only when the image digest moves (the app never pulls itself). Reference consumer: artifact-console.
- **Config:** the app-config standard -- one operator-edited answer file under `/opt/kenzen/prod/`, generated `.env`/compose, additive-only schema, secrets runtime-only (`KENZEN_INGEST_TOKEN`, the tunnel token, the registry pull credential), config path logged at every boot, `KENZEN_CONFIG_DIR` / `KENZEN_STATE_DIR` overrides absolute-only. State volume `state` holds `kenzen.db`. `PUT /api/decisions/*` (section 11) needs `KENZEN_ACCESS_TEAM_DOMAIN`/`KENZEN_ACCESS_AUD` set (both-or-neither, `config.ts`) or it has no verified Access identity path: a real Access-gated request (one carrying the Cloudflare JWT header, which Access injects independently of these two app-side vars) is rejected outright regardless of `KENZEN_DEV_IDENTITY`. The boot log's `accessConfigured` field is the tell, and the server also warns at boot when it's `false` (K4-6c, `app.ts`).
- **Cloudflare side:** all via the API per Tooling `docs/per-app-cloudflare-access-tunnel.md` (hostname, tunnel, Access app + policy), no dashboard clicking.
- **Monitoring:** an Uptime Kuma HTTP monitor through the gate with a service token (the `env_health` pattern), and a `watched-apps.json` entry (`links` under Apps, `monitored: true`).
- **Backups:** the `state` volume is the whole disaster-recovery story (as with Uptime Kuma); the research-triage backup doc's shape applies.

## 8. Reuse table (roshne, 2026-09-07: "don't let it forget all the tools I've built")

| Need | Asset consumed | How |
|---|---|---|
| Access-gated origin, tunnel sidecar, restart-on-update | `Rackbops/rackbops-web-deploy-template` `servers/node-app` + `gate/` | copy-consumed (`.example` files) |
| Cloudflare hostname/tunnel/Access via API | Tooling `docs/per-app-cloudflare-access-tunnel.md` | followed |
| Config/secrets layout | app-config standard (personal CLAUDE.md) | followed; answer file + generated files |
| Image publish, image ratchet, migrations contract, `/healthz` shape | artifact-console 2.0 `release.yml`, `image-ratchet.yml`, `scripts/assert-image.mjs`, `packages/host/migrations/README.md` | copied, cited |
| UI theme + components | `@rackbops/styles`, `@rackbops/ui-react` (`Button`, `Card`, `NavLink`) | imported |
| Repo scaffold, TS baseline, frontend test config, export gotchas | Tooling `docs/non-addon-repo-scaffold.md` §1-3, 5-7, 11-12 | followed |
| CI runners | org disposable pool + `docker` DinD slot; `Wait-PRChecks.ps1` | `runs-on` labels; `/pr` flow |
| Data in | Tooling `software_inventory.py` + `software_report.py` outputs | ingested; schemas vendored byte-identically |
| Decision semantics | discord-bot `src/plugins/updates.ts` | copied, cited (section 5) |
| Notifications | Tooling `notify.py` + `software_digest.py` | Kenzen has no Discord path in 1.0 |
| Monitoring | Uptime Kuma (nitro, MCP), `watched-apps.json`, Beszel/Loki on the host | monitor + entry |
| Dependency hygiene | `Rackbops/renovate-config` (Interactive, approval-gated), org dependency-graph configuration 273079, Dependabot alerts | already on the repo (Tooling#475) |
| Labels, permission rules | `labels.json`/`sync_labels.py`, `docs/permission-rules-standard.md` | applied (#475) / to apply |
| Push notifications | `addon-ci` `push-notify.yml` with the runner input, `DISCORD_PUSH_WEBHOOK` | wired (#475) |

Rows marked *build* in the plan: the data table + tab strip components (nothing in the design system yet), the ingest/decisions API (Kenzen-specific), the snapshot/history model (Kenzen-specific).

## 9. Give-back table (roshne, 2026-09-07: "anything it builds needs to be added to tooling for the next time anything needs it")

| Built in Kenzen | Generic? | Goes to | Filed as |
|---|---|---|---|
| `DataTable` (sortable, grouped rows, sticky header) and `Tabstrip` on the `rb-*` contract | yes | `Rackbops/rackbops-ui-ux-std-lib` | a child of Tooling#473 when the components stabilise (plan: after K4-8) |
| JSON Schemas for `software-inventory.json` / `software-report.json` | yes (the contract) | `Rackbops/Tooling` `schemas/` (source of truth; Kenzen vendors) | Tooling#477 |
| Kenzen pipeline runbook (token, publish, fallback) | yes | Tooling `docs/kenzen-pipeline.md` | Tooling#477 |
| `migrate.ts` + config-resolution + `/healthz` boilerplate, now with two consumers (AC 2.0, Kenzen) | probably | a shared package (`@rackbops/node-app-kit`) -- decide after both ship; do not pre-extract | a Tooling#473 child filed by Tooling#482's re-evaluation if the duplication is real |
| Uptime Kuma monitor-through-Access recipe | yes, if it differs from `env_health`'s | Tooling `docs/uptime-kuma-suppress-monitor.md` sibling | K5 (#479) notes it |

## 10. Ratchets and testing **[proposed]**

Two ratchets land before the first feature (AC 2.0's lesson, copied):

- **Image ratchet:** CI builds the real image on the `docker` DinD slot, boots it with an empty config, asserts `/healthz` returns `{ok:true, version, apiVersion:1}` and the SPA serves. Catches "code that only works in a checkout".
- **Contract ratchet:** a fixture test that Tooling's *actual* emitted files (a committed sample of `software-inventory.json` and `software-report.json` from the day the schemas were pinned) validate against `packages/contract/schemas/`, and that the ingest handler accepts them. Catches "a contract that drifts from its consumers". The schemas are byte-identical twins with Tooling (`shared-helpers-manifest.json`).

Everything else: Vitest per package; decision-model rules table-tested (the four fields x newer/equal/older targets x cleared); mutation testing per PR under the three-reviewer gate.

## 11. Security posture

Access is the door; the app publishes no host port; ingest needs the bearer token; write endpoints (`PUT /api/decisions/*`) require the Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`, verified against the team's certs as the bot's admin panel does **[code: discord-bot ops/admin]**) and record the identity as `updatedBy`; read endpoints are gate-only. No secrets in the image (`docker history` clean is part of K5's acceptance). Advisory data is public; the inventory names private repos and their unpatched versions, which is why nothing here is public.

## 12. Keeping the AC 2.0 plugin door open (Tooling#482)

| Kenzen piece | AC 2.0 contribution point it maps to |
|---|---|
| Dashboard view (sections 1-5) | `panel` |
| Estate soundness line | `card` on Overview |
| skip / remind / approve / acknowledge | `action` |
| re-score, pull from Tooling | `job` |
| `/api/ingest`, `/api/decisions` | `route` (`/api/x/kenzen/...`) |
| ingest token | `setting` |

The server is written as a Hono app mounted under a prefix with its own SQLite file, the UI as a router-mounted React tree with no global shell assumptions, so a port is re-hosting. What would be app-only: the deploy stack and the standalone shell.

## 13. Deferred past 1.0 (explicitly)

Running the scanner from Kenzen (a button through AC 2.0's agent); multi-user roles beyond the Access identity; a score; Bolt or other feeds as separate ingest sources (Tooling#462 decides whether that feed exists at all); public status pages.

## 14. Questions put to roshne -- all answered 2026-09-08 (the app-vs-plugin decision itself was 2026-09-07)

1. Stack: TypeScript, AC 2.0's choices -- **approved**.
2. Hostname: `kenzen.rackbops.com`, Access-gated -- **approved**.
3. Host: nucbox -- **approved** after measuring both boxes (section 7).
4. Pipeline ownership: Tooling publishes, Kenzen never scans in 1.0 -- **approved**.
