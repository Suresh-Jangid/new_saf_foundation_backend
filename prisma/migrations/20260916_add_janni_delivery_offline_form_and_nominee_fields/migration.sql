-- AlterTable
ALTER TABLE "janni_delivery_registrations"
  ADD COLUMN IF NOT EXISTS "offline_form_number" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "nominee_aadhar" VARCHAR(12),
  ADD COLUMN IF NOT EXISTS "nominee_photo_url" VARCHAR(512);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "janni_delivery_registrations_offline_form_number_idx"
  ON "janni_delivery_registrations"("offline_form_number");
