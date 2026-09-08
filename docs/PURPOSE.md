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
- **Not public.** Private repo; the app sits behind Cloudflare Access, same as roshne's other
  personal tools.

## Intended audience

roshne, solo -- same as `Tooling` and `artifact-console`. Not written for a fork or an outside
contributor to adopt.

## Roadmap

This repo is provisioned ahead of any app code
([`Rackbops/Tooling#475`](https://github.com/Rackbops/Tooling/issues/475)). What comes next, in
order, all tracked under
[`Rackbops/Tooling` epic #473](https://github.com/Rackbops/Tooling/issues/473):

1. **#476** -- design doc: stack decision, data model, API shape, Reuse table.
2. **#478** -- the build, split into child issues here once #476 lands.
3. **#479** -- Kenzen live, added to `watched-apps.json`.
4. **#480** -- close the loop: `Tooling#427`'s interim Markdown page retired or demoted to a
   fallback, epic #430 closed.

The epic is the source of truth for the plan; this file tracks only the one-paragraph summary
and non-goals, not the roadmap's detail.
