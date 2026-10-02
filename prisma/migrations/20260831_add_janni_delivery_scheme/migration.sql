-- SAF Foundation — Phase 6-A Migration: Janni Delivery Registration & Installments
-- Strictly Additive Migration Review:
-- DROP TABLE = 0
-- DROP COLUMN = 0
-- TRUNCATE = 0
-- DELETE = 0

-- CreateTable: janni_delivery_registrations
CREATE TABLE IF NOT EXISTS "janni_delivery_registrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sr_no" SERIAL NOT NULL,
    "form_number" VARCHAR(50) NOT NULL,
    "application_date" DATE NOT NULL,
    "applicant_name" VARCHAR(100) NOT NULL,
    "father_name" VARCHAR(100) NOT NULL,
    "husband_name" VARCHAR(100),
    "mother_name" VARCHAR(100),
    "date_of_birth" DATE NOT NULL,
    "age" INTEGER,
    "aadhar_number" VARCHAR(12) NOT NULL,
    "gotra" VARCHAR(50) NOT NULL,
    "mobile" VARCHAR(15) NOT NULL,
    "address" TEXT NOT NULL,
    "pin_code" VARCHAR(10) NOT NULL,
    "tehsil" VARCHAR(100) NOT NULL,
    "district" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL DEFAULT 'Rajasthan',
    "child_name" VARCHAR(100),
    "child_gender" "Gender",
    "delivery_date" DATE,
    "hospital_name" VARCHAR(200),
    "nominee_name" VARCHAR(100),
    "nominee_relation" VARCHAR(50),
    "nominee_mobile" VARCHAR(15),
    "passport_photo_url" VARCHAR(512),
    "affidavit_url" VARCHAR(512),
    "gender" "Gender" NOT NULL DEFAULT 'Female',
    "category" "ApplicationCategory" NOT NULL DEFAULT 'A',
    "total_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pending_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "epin_code" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "added_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "janni_delivery_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: janni_delivery_installments
CREATE TABLE IF NOT EXISTS "janni_delivery_installments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "registration_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "rashid_number" VARCHAR(50),
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'CASH',
    "added_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "janni_delivery_installments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique Constraints & Query Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "janni_delivery_registrations_sr_no_key" ON "janni_delivery_registrations"("sr_no");
CREATE UNIQUE INDEX IF NOT EXISTS "janni_delivery_registrations_form_number_key" ON "janni_delivery_registrations"("form_number");
CREATE INDEX IF NOT EXISTS "janni_delivery_registrations_form_number_idx" ON "janni_delivery_registrations"("form_number");
CREATE INDEX IF NOT EXISTS "janni_delivery_registrations_mobile_idx" ON "janni_delivery_registrations"("mobile");
CREATE INDEX IF NOT EXISTS "janni_delivery_registrations_aadhar_number_idx" ON "janni_delivery_registrations"("aadhar_number");
CREATE INDEX IF NOT EXISTS "janni_delivery_registrations_gender_idx" ON "janni_delivery_registrations"("gender");
CREATE INDEX IF NOT EXISTS "janni_delivery_registrations_added_by_id_idx" ON "janni_delivery_registrations"("added_by_id");
CREATE INDEX IF NOT EXISTS "janni_delivery_registrations_application_date_idx" ON "janni_delivery_registrations"("application_date");
CREATE INDEX IF NOT EXISTS "janni_delivery_registrations_created_at_idx" ON "janni_delivery_registrations"("created_at");
CREATE INDEX IF NOT EXISTS "janni_delivery_registrations_deleted_at_idx" ON "janni_delivery_registrations"("deleted_at");

CREATE INDEX IF NOT EXISTS "janni_delivery_installments_registration_id_date_idx" ON "janni_delivery_installments"("registration_id", "date");
CREATE INDEX IF NOT EXISTS "janni_delivery_installments_added_by_id_date_idx" ON "janni_delivery_installments"("added_by_id", "date");
CREATE INDEX IF NOT EXISTS "janni_delivery_installments_deleted_at_idx" ON "janni_delivery_installments"("deleted_at");

-- AddForeignKey Constraints
ALTER TABLE "janni_delivery_registrations" DROP CONSTRAINT IF EXISTS "janni_delivery_registrations_added_by_id_fkey";
ALTER TABLE "janni_delivery_registrations" ADD CONSTRAINT "janni_delivery_registrations_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "janni_delivery_installments" DROP CONSTRAINT IF EXISTS "janni_delivery_installments_added_by_id_fkey";
ALTER TABLE "janni_delivery_installments" ADD CONSTRAINT "janni_delivery_installments_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "janni_delivery_installments" DROP CONSTRAINT IF EXISTS "janni_delivery_installments_registration_id_fkey";
ALTER TABLE "janni_delivery_installments" ADD CONSTRAINT "janni_delivery_installments_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "janni_delivery_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
