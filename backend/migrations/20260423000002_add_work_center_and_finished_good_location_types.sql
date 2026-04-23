-- Work Orders & BOM — Migration 2/5.
-- NOTE: Postgres forbids referencing a newly-added enum value inside the same
-- transaction that added it. sqlx's migration wrapper commits each file in its
-- own transaction, so these ALTER TYPE statements commit before migration 3
-- (which references the new values in a partial unique index + backfill).
-- NOTHING ELSE belongs in this file.
ALTER TYPE location_type ADD VALUE IF NOT EXISTS 'work_center';
ALTER TYPE location_type ADD VALUE IF NOT EXISTS 'finished_good';
