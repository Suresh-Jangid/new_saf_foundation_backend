-- SAF Foundation — Migration: Add muklawa_date to Lado Bahin Registration
-- Strictly Additive Migration Review:
-- DROP TABLE = 0
-- DROP COLUMN = 0
-- TRUNCATE = 0
-- DELETE = 0

-- AlterTable: lado_bahin_registrations
ALTER TABLE "lado_bahin_registrations" ADD COLUMN IF NOT EXISTS "muklawa_date" DATE;
