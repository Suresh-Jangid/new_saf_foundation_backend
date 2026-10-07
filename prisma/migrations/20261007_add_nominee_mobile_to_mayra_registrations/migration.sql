-- AlterTable
ALTER TABLE "mayra_registrations"
  ADD COLUMN IF NOT EXISTS "nominee_mobile" VARCHAR(15);
