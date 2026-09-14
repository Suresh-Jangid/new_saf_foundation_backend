-- AlterTable
ALTER TABLE "dhundhotsav_registrations" ADD COLUMN IF NOT EXISTS "offline_form_number" VARCHAR(50);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dhundhotsav_registrations_offline_form_number_idx" ON "dhundhotsav_registrations"("offline_form_number");
