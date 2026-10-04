-- AlterTable
ALTER TABLE "general_applications"
ADD COLUMN IF NOT EXISTS "nominee_photo_url" VARCHAR(512);
