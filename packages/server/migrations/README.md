# Migrations

Numbered SQL applied at boot by [`../src/migrate.ts`](../src/migrate.ts), tracked by
`PRAGMA user_version` (the schema version *is* `user_version` — no bookkeeping table to drift).
Copied verbatim from `Rackbops/artifact-console`'s `packages/host/migrations/README.md`
(design.md section 3) — the contract below is identical, only the repo-relative paths differ.

**Authoring contract** (enforced or load-bearing — do not break it):

- Name each file `NNNN_name.sql` with a **4-digit, zero-padded, unique** number. A `.sql` file that
  doesn't match, or a duplicate number, is a **hard error at boot** — never a silent skip.
- **Append-only and immutable.** A shipped migration has already run on deployed instances (their
  `user_version` is past it), so editing it never re-runs there and only drifts fresh installs. To
  change the schema, add a **higher-numbered** migration. (This is an
  [escalation-class](../../../CLAUDE.md) contract: existing installs resolve their data by it.)
- Each file runs inside **one implicit transaction** (`migrate.ts` wraps it in `BEGIN`/`COMMIT`); a
  failure rolls the whole file back. Do **not** put `BEGIN`/`COMMIT` in a file.
- These files ship in the image as a sibling of `dist/` — the Dockerfile (K4-6) must copy them, or
  boot fails with `ENOENT`.
