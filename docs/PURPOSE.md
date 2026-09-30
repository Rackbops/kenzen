# Purpose

## The problem being solved

**Kenzen-sei** (健全性, "soundness / integrity of a system"; casually **Kenzen**) is the
software-soundness dashboard for every repo roshne owns: one place that shows, per repo, what
software it uses by role (runtime, infra, ci, build, test), the pinned version, the latest
available, and any advisory against the pinned version -- and where a human records the
decision (approve / skip / remind later) that the daily digest then honours. It replaces the
Markdown-report approach piloted in
[`Rackbops/Tooling#427`](https://github.com/Rackbops/Tooling/issues/427) with a real app: a UI,
decision state with history, and an API the daily digest reads back from instead of a
hand-edited JSON file. It never bumps a dependency itself -- Renovate, gated by a human tick,
does that.

`Tooling` stays the collection engine (`software_inventory.py`, `software_report.py`, the daily
task and Discord digest); Kenzen is the product surface on top of that data.

## Non-goals

- **Not a dependency-bumping tool.** Kenzen surfaces and records decisions; only a
  human-approved Renovate PR ever changes a pinned version.
- **Not a general-purpose ops dashboard.** Scope is the inventory + report + decision data
  model from epic #430/#473 -- it does not grow into an unrelated console (that is
  `artifact-console`'s job).
- **Not the collection engine.** Scanning repos, resolving latest versions, and querying
  advisory feeds stays in `Tooling` (`software_inventory.py`/`software_report.py`); Kenzen
  consumes that output, it does not duplicate the scan.
- **Not a public service.** The repo is public (since 2026-09-21), but the app sits behind
  Cloudflare Access, same as roshne's other personal tools.

## Intended audience

roshne, solo -- same as `Tooling` and `artifact-console`. Not written for a fork or an outside
contributor to adopt.

## Roadmap

Epic [`Rackbops/Tooling#473`](https://github.com/Rackbops/Tooling/issues/473) is closed: the
design doc (#476), the v1 build (#478), the deploy behind Cloudflare Access (#479) and closing
the loop with epic #430 (#480) all landed on 2026-09-08.

**Standalone, not an artifact-console plugin** (decided 2026-09-30,
[`Rackbops/Tooling#482`](https://github.com/Rackbops/Tooling/issues/482)). Once artifact-console
2.0's shell landed, #482 re-asked whether Kenzen should become one of its plugins. Verdict: stay
standalone. An in-process artifact-console 2.0 plugin gets only a JSON key/value store (no SQL,
no migrations), so Kenzen's relational decision store would have to be rewritten.
artifact-console also passes no caller identity to plugin routes or actions, so Kenzen would
keep its own Access verification anyway. Revisit if artifact-console 2.0 adds per-plugin
relational storage with migrations and passes caller identity to plugins.
