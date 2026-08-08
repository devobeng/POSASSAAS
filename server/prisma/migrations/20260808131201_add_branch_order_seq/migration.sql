-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "nextOrderSeq" INTEGER NOT NULL DEFAULT 1;

-- Backfill: continue numbering from each branch's current order count so
-- existing branches don't reset to BR1-000001 and collide with real history.
UPDATE "branches" b
SET "nextOrderSeq" = COALESCE((SELECT COUNT(*) FROM "orders" o WHERE o."branchId" = b.id), 0) + 1;
