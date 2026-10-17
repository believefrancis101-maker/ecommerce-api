-- AddColumn
ALTER TABLE "Category" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Product" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Customer" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: rows that already exist would otherwise be stamped with the clock
-- time of this migration (CURRENT_TIMESTAMP), which is different on every run.
-- We force one FIXED value instead so a populated database, a fresh database
-- and the deterministic seed all agree on createdAt. New rows still get
-- CURRENT_TIMESTAMP from the column default; the seed writes this same value.
UPDATE "Category" SET "createdAt" = TIMESTAMP '2026-01-01 00:00:00';
UPDATE "Product" SET "createdAt" = TIMESTAMP '2026-01-01 00:00:00';
UPDATE "Customer" SET "createdAt" = TIMESTAMP '2026-01-01 00:00:00';
