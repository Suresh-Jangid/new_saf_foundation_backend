-- AlterTable
ALTER TABLE "mayra_registrations" ADD COLUMN IF NOT EXISTS "offline_form_number" VARCHAR(50);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "mayra_registrations_offline_form_number_idx" ON "mayra_registrations"("offline_form_number");
