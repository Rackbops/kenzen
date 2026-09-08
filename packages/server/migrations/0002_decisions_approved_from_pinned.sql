-- Additive: a companion field to `approvedVersion`, capturing the item's `pinned` string AT THE
-- MOMENT of approval (Tooling#478 K4-5 review round 1, HIGH). `pinned` is stored verbatim as
-- written (software_inventory.py) -- a major/floating pin like "^14.27.0" never becomes a bare
-- resolved version even after the PR merges (it becomes "^14.28.0"), so comparing the CURRENT
-- `pinned` against the bare `approvedVersion` string can never detect "the PR landed" for
-- anything but an exact-style pin. Storing the pre-approval `pinned` value lets suppressionState
-- detect "pinned changed at all" with a plain string comparison, independent of pinStyle.

ALTER TABLE decisions ADD COLUMN approved_from_pinned TEXT;
