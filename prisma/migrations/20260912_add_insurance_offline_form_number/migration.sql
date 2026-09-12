-- AlterTable
ALTER TABLE "insurance_applications" ADD COLUMN IF NOT EXISTS "offline_form_number" VARCHAR(50);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "insurance_applications_offline_form_number_idx" ON "insurance_applications"("offline_form_number");
