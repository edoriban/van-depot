-- Migration A: add the 'reception' value to the location_type enum.
-- Split from the companion migration because Postgres does not allow a newly-added
-- enum value to be referenced inside the same transaction that added it.
ALTER TYPE location_type ADD VALUE IF NOT EXISTS 'reception';
