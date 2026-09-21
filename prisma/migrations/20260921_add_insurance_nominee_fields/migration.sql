-- AlterTable
ALTER TABLE "insurance_applications"
  ADD COLUMN IF NOT EXISTS "nominee_aadhar" VARCHAR(12),
  ADD COLUMN IF NOT EXISTS "nominee_mobile" VARCHAR(15),
  ADD COLUMN IF NOT EXISTS "nominee_photo_url" VARCHAR(512);
