-- Migration A: create the product_class enum type.
-- Split from the companion migration because Postgres forbids referencing a
-- newly-created enum value inside the same transaction that created it. The
-- column addition + backfill + CHECK constraint land in 20260421000002.
CREATE TYPE product_class AS ENUM ('raw_material', 'consumable', 'tool_spare');
