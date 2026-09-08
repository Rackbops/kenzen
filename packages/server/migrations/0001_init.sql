-- The initial Kenzen schema (Tooling#478 K4-3; design.md section 4). One snapshot per ingest of
-- Tooling's software-inventory.json + software-report.json, never overwritten -- history is the
-- point (design.md section 4.2). items/repos are joined-and-flattened per snapshot; decisions/
-- decision_history are keyed by item (repo|kind|name|source), independent of any one snapshot,
-- since a decision persists across ingests until a human changes it (design.md section 5).

CREATE TABLE snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  generatedAt    TEXT NOT NULL UNIQUE,
  inventoryItems INTEGER NOT NULL,
  summary_json   TEXT NOT NULL,
  ingestedAt     TEXT NOT NULL
);

-- One row per inventory+report item in a snapshot, joined on repo|kind|name|source (design.md
-- section 4.2). `resolver` is backfilled from the inventory item -- the report drops it
-- (design.md section 4.1: ReportItem carries the Item fields except resolver). `latest` /
-- `latestInMajor` / `gap` / `advisoryStatus` / `advisories_json` / `note` are nullable: an
-- inventory item with no matching report row is stored with those null and
-- note = "not in report" (design.md section 4.2).
CREATE TABLE items (
  snapshotId      INTEGER NOT NULL REFERENCES snapshots(id),
  key             TEXT NOT NULL,
  repo            TEXT NOT NULL,
  kind            TEXT NOT NULL,
  name            TEXT NOT NULL,
  pinned          TEXT,
  pinStyle        TEXT,
  role            TEXT,
  source          TEXT,
  resolver        TEXT,
  latest          TEXT,
  latestInMajor   TEXT,
  gap             TEXT,
  advisoryStatus  TEXT,
  advisories_json TEXT,
  assumed         TEXT,
  note            TEXT,
  UNIQUE (snapshotId, key)
);
CREATE INDEX idx_items_key ON items(key);

-- One row per repo in a snapshot: its Dependabot alert read-back and the soundness-line summary
-- (design.md sections 4.3, 6) as of that snapshot.
CREATE TABLE repos (
  snapshotId      INTEGER NOT NULL REFERENCES snapshots(id),
  repo            TEXT NOT NULL,
  dependabot_json TEXT,
  soundness_json  TEXT,
  UNIQUE (snapshotId, repo)
);

-- The current decision per item, independent of any one snapshot (design.md section 5). `key`
-- matches items.key (repo|kind|name|source) but is not enforced as a foreign key: a decision
-- can be recorded before an item's first ingest, or outlive the item disappearing from a later
-- snapshot -- neither is an error.
CREATE TABLE decisions (
  key               TEXT PRIMARY KEY,
  repo              TEXT NOT NULL,
  kind              TEXT,
  name              TEXT NOT NULL,
  source            TEXT,
  skippedVersion    TEXT,
  remindAt          TEXT,
  approvedVersion   TEXT,
  acknowledged_json TEXT,
  updatedAt         TEXT NOT NULL,
  updatedBy         TEXT
);

-- An append-only audit trail of every decision change. Not a foreign key to decisions.key: a
-- decision row's own future lifecycle (a PUT {clear: true}, design.md section 4.3) isn't decided
-- yet, and history must survive regardless of what later happens to the current-state row.
CREATE TABLE decision_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT NOT NULL,
  at          TEXT NOT NULL,
  by          TEXT
);
CREATE INDEX idx_decision_history_key ON decision_history(key);
