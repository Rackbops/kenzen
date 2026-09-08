# Fixtures

`software-inventory.sample.json` and `software-report.sample.json` are a **trimmed** subset of
the real files Tooling produced on 2026-09-08 (`generatedAt: 2026-09-08T02:59:05Z`, 751 items
across 21 owned + 6 read-only repos) -- the full report is 816 KB, too large for a committed
fixture. Trimmed to 9 report items (+ 1 inventory-only item, 10 inventory items total) covering,
by construction (see the one-off script that built these, not committed):

- every `kind` (`dockerfile-base`, `compose-image`, `github-action`, `npm-dep`, `pip-dep`,
  `runtime-pin`)
- every `advisoryStatus` (`affected`, `historical-only`, `none`, `unknown`)
- every `gap` (`none`, `patch`, `minor`, `major`, `unknown`)
- the bot's real `cloudflare/cloudflared` item (`Rackbops/rackbops-discord-bot`,
  `docker-compose.yml:112`) with its two real historical advisories -- the exact item kenzen#6's
  acceptance bullet names
- one item present **only** in the inventory fixture (`Lepid-Labs/Lorepath`'s
  `lorearc/lorepath` compose image), absent from the report fixture, to exercise the
  inventory-only-item backfill path (nulls + `note = "not in report"`)

All selected items and their real field values (pins, versions, advisory ids/URLs/summaries) are
byte-identical to the real production output -- nothing here is synthesized. `software-report
.sample.json`'s `summary` block **is** recomputed from the 9 trimmed items (`gap`/`advisoryStatus`
counts only; `resolverCalls` is empty), since the real run's full-751-item summary would no
longer describe this fixture's own contents -- an internally-inconsistent fixture would be
misleading regardless of source fidelity.

Both files validate against `../schemas/*.schema.json` -- see `../src/validate.test.ts`, the
contract ratchet.
