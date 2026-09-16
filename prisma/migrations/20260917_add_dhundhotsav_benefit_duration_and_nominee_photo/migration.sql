-- AlterTable
ALTER TABLE "dhundhotsav_registrations"
  ADD COLUMN IF NOT EXISTS "benefit_duration" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "nominee_photo_url" VARCHAR(512);
