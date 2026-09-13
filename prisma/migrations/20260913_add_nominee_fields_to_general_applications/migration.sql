-- AlterTable
ALTER TABLE "general_applications"
ADD COLUMN IF NOT EXISTS "nominee_aadhar" VARCHAR(12),
ADD COLUMN IF NOT EXISTS "nominee_mobile" VARCHAR(15);
