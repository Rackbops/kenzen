# Migrations

Numbered SQL applied at boot by `@rackbops/node-app-kit`'s `migrate()`, tracked by
`PRAGMA user_version` (the schema version *is* `user_version` — no bookkeeping table to drift).
The mechanism used to live in this repo's own `src/migrate.ts`; it was extracted into the shared
package (`Rackbops/Tooling#511`) once Kenzen became its second consumer, since a fix found here
(the `0000` trap below) had already drifted from `Rackbops/artifact-console`'s own copy once.
**This directory holds only Kenzen's own numbered `.sql` files -- the mechanism and its full
authoring contract now live at
[`@rackbops/node-app-kit`'s `docs/migrations-authoring-contract.md`](https://github.com/Rackbops/rackbops-node-app-kit/blob/main/docs/migrations-authoring-contract.md).**
The contract summary, so it doesn't need a second hop for the load-bearing parts:

- Name each file `NNNN_name.sql` with a **4-digit, zero-padded, unique** number. A `.sql` file that
  doesn't match, or a duplicate number, is a **hard error at boot** — never a silent skip.
- **Numbers start at `0001`, not `0000`.** `migrate()` rejects a `0000_*.sql` file outright (an
  adversarial review on Tooling#478 K4-3 found that `0000` would otherwise be silently and
  permanently skipped forever, since a fresh database's schema version already starts at 0 -- the
  trap that led to this package's extraction in the first place, per the paragraph above).
- **Append-only and immutable.** A shipped migration has already run on deployed instances (their
  `user_version` is past it), so editing it never re-runs there and only drifts fresh installs. To
  change the schema, add a **higher-numbered** migration. (This is an
  [escalation-class](../../../CLAUDE.md) contract: existing installs resolve their data by it.)
- Each file runs inside **one implicit transaction** (`migrate()` wraps it in `BEGIN`/`COMMIT`); a
  failure rolls the whole file back. Do **not** put `BEGIN`/`COMMIT` in a file.
- These files ship in the image as a sibling of `dist/` — the Dockerfile (K4-6) must copy them, or
  boot fails with `ENOENT`.
