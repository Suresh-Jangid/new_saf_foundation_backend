-- SAF Foundation — Phase 10-A Migration: ShubhLaxmi Registration & Isolated Single ₹300 Installment Ledger
-- Strictly Additive Migration Review:
-- DROP TABLE = 0
-- DROP COLUMN = 0
-- TRUNCATE = 0
-- DELETE = 0

-- CreateTable: shubh_laxmi_registrations
CREATE TABLE IF NOT EXISTS "shubh_laxmi_registrations" (
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
    "nominee_name" VARCHAR(100),
    "nominee_relation" VARCHAR(50),
    "nominee_mobile" VARCHAR(15),
    "nominee_aadhar" VARCHAR(12),
    "passport_photo_url" VARCHAR(512),
    "affidavit_url" VARCHAR(512),
    "gender" "Gender" NOT NULL DEFAULT 'Female',
    "category" "ApplicationCategory" NOT NULL DEFAULT 'A',
    "scheme_type" VARCHAR(50) NOT NULL DEFAULT 'SHUBH_LAXMI',
    "pool" VARCHAR(50) NOT NULL DEFAULT 'UNIFIED_POOL',
    "membership_fee" DECIMAL(10,2) NOT NULL DEFAULT 3100,
    "epin_code" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "added_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "shubh_laxmi_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: shubh_laxmi_installments
CREATE TABLE IF NOT EXISTS "shubh_laxmi_installments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "registration_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL DEFAULT 300,
    "date" DATE NOT NULL,
    "note" TEXT,
    "rashid_number" VARCHAR(50),
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'CASH',
    "added_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "shubh_laxmi_installments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique Constraints & Query Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "shubh_laxmi_registrations_sr_no_key" ON "shubh_laxmi_registrations"("sr_no");
CREATE UNIQUE INDEX IF NOT EXISTS "shubh_laxmi_registrations_form_number_key" ON "shubh_laxmi_registrations"("form_number");
CREATE INDEX IF NOT EXISTS "shubh_laxmi_registrations_form_number_idx" ON "shubh_laxmi_registrations"("form_number");
CREATE INDEX IF NOT EXISTS "shubh_laxmi_registrations_mobile_idx" ON "shubh_laxmi_registrations"("mobile");
CREATE INDEX IF NOT EXISTS "shubh_laxmi_registrations_aadhar_number_idx" ON "shubh_laxmi_registrations"("aadhar_number");
CREATE INDEX IF NOT EXISTS "shubh_laxmi_registrations_gender_idx" ON "shubh_laxmi_registrations"("gender");
CREATE INDEX IF NOT EXISTS "shubh_laxmi_registrations_scheme_type_idx" ON "shubh_laxmi_registrations"("scheme_type");
CREATE INDEX IF NOT EXISTS "shubh_laxmi_registrations_pool_idx" ON "shubh_laxmi_registrations"("pool");
CREATE INDEX IF NOT EXISTS "shubh_laxmi_registrations_added_by_id_idx" ON "shubh_laxmi_registrations"("added_by_id");
CREATE INDEX IF NOT EXISTS "shubh_laxmi_registrations_application_date_idx" ON "shubh_laxmi_registrations"("application_date");
CREATE INDEX IF NOT EXISTS "shubh_laxmi_registrations_created_at_idx" ON "shubh_laxmi_registrations"("created_at");
CREATE INDEX IF NOT EXISTS "shubh_laxmi_registrations_deleted_at_idx" ON "shubh_laxmi_registrations"("deleted_at");

CREATE INDEX IF NOT EXISTS "shubh_laxmi_installments_registration_id_date_idx" ON "shubh_laxmi_installments"("registration_id", "date");
CREATE INDEX IF NOT EXISTS "shubh_laxmi_installments_added_by_id_date_idx" ON "shubh_laxmi_installments"("added_by_id", "date");
CREATE INDEX IF NOT EXISTS "shubh_laxmi_installments_deleted_at_idx" ON "shubh_laxmi_installments"("deleted_at");

-- AddForeignKey Constraints
ALTER TABLE "shubh_laxmi_registrations" DROP CONSTRAINT IF EXISTS "shubh_laxmi_registrations_added_by_id_fkey";
ALTER TABLE "shubh_laxmi_registrations" ADD CONSTRAINT "shubh_laxmi_registrations_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shubh_laxmi_installments" DROP CONSTRAINT IF EXISTS "shubh_laxmi_installments_added_by_id_fkey";
ALTER TABLE "shubh_laxmi_installments" ADD CONSTRAINT "shubh_laxmi_installments_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shubh_laxmi_installments" DROP CONSTRAINT IF EXISTS "shubh_laxmi_installments_registration_id_fkey";
ALTER TABLE "shubh_laxmi_installments" ADD CONSTRAINT "shubh_laxmi_installments_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "shubh_laxmi_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
