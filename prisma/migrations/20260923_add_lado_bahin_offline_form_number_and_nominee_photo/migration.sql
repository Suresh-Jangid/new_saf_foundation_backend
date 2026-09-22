-- SAF Foundation — Lado Bahin Scheme Migration: Add offline_form_number and nominee_photo_url
-- Strictly Additive Migration Review:
-- DROP TABLE = 0
-- DROP COLUMN = 0
-- TRUNCATE = 0
-- DELETE = 0

-- AlterTable: Add offline_form_number and nominee_photo_url to lado_bahin_registrations
ALTER TABLE "lado_bahin_registrations" ADD COLUMN IF NOT EXISTS "offline_form_number" VARCHAR(50);
ALTER TABLE "lado_bahin_registrations" ADD COLUMN IF NOT EXISTS "nominee_photo_url" VARCHAR(512);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lado_bahin_registrations_offline_form_number_idx" ON "lado_bahin_registrations"("offline_form_number");
