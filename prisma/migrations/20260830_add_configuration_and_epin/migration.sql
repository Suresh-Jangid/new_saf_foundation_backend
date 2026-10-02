-- SAF Foundation Phase 2-A Database Migration
-- Purpose: Add centralized ApplicationConfig, ModuleConfig, SchemeMaster, SchemeTypeConfig, PoolConfig, Category 'F', and E-PIN state machine models
-- Safety: Non-destructive, additive only. Does not drop or modify any existing tables or rows.

-- 1. Extend ApplicationCategory enum with 'F'
ALTER TYPE "ApplicationCategory" ADD VALUE IF NOT EXISTS 'F';

-- 2. Create EPinStatus enum
DO $$ BEGIN
    CREATE TYPE "EPinStatus" AS ENUM ('ACTIVE', 'ASSIGNED', 'USED', 'BURNT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Create application_configs table
CREATE TABLE IF NOT EXISTS "application_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "app_name" VARCHAR(100) NOT NULL DEFAULT 'SAF Foundation',
    "mobile" VARCHAR(20) NOT NULL DEFAULT '9950730637',
    "contact_email" VARCHAR(100),
    "address" VARCHAR(255),
    "default_deduction_percent" DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "application_configs_pkey" PRIMARY KEY ("id")
);

-- 4. Create module_configs table
CREATE TABLE IF NOT EXISTS "module_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "parent_module" VARCHAR(50),
    "permissions" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "module_configs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "module_configs_code_key" UNIQUE ("code")
);

-- 5. Create scheme_masters table
CREATE TABLE IF NOT EXISTS "scheme_masters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "module_code" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "pool_type" VARCHAR(50) NOT NULL DEFAULT 'FEMALE_POOL',
    "deduction_percent" DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scheme_masters_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scheme_masters_code_key" UNIQUE ("code")
);

-- 6. Create scheme_type_configs table
CREATE TABLE IF NOT EXISTS "scheme_type_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scheme_type_configs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scheme_type_configs_code_key" UNIQUE ("code")
);

-- 7. Create pool_configs table
CREATE TABLE IF NOT EXISTS "pool_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "gender" VARCHAR(20),
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pool_configs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pool_configs_code_key" UNIQUE ("code")
);

-- 8. Create e_pins table
CREATE TABLE IF NOT EXISTS "e_pins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pin_code" VARCHAR(50) NOT NULL,
    "scheme_code" VARCHAR(50) NOT NULL,
    "slab_code" VARCHAR(50),
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "EPinStatus" NOT NULL DEFAULT 'ACTIVE',
    "generated_by_id" UUID NOT NULL,
    "assigned_to_id" UUID,
    "assigned_at" TIMESTAMP(3),
    "used_by_id" UUID,
    "used_at" TIMESTAMP(3),
    "used_in_module" VARCHAR(50),
    "used_entity_id" UUID,
    "burnt_by_id" UUID,
    "burnt_at" TIMESTAMP(3),
    "burn_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "e_pins_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "e_pins_pin_code_key" UNIQUE ("pin_code")
);

-- Indexes for e_pins
CREATE INDEX IF NOT EXISTS "e_pins_status_idx" ON "e_pins"("status");
CREATE INDEX IF NOT EXISTS "e_pins_scheme_code_idx" ON "e_pins"("scheme_code");
CREATE INDEX IF NOT EXISTS "e_pins_assigned_to_id_idx" ON "e_pins"("assigned_to_id");

-- 9. Create e_pin_audit_logs table
CREATE TABLE IF NOT EXISTS "e_pin_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "epin_id" UUID NOT NULL,
    "from_status" "EPinStatus",
    "to_status" "EPinStatus" NOT NULL,
    "performed_by_id" UUID NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "e_pin_audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "e_pin_audit_logs_epin_id_fkey" FOREIGN KEY ("epin_id") REFERENCES "e_pins"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Index for e_pin_audit_logs
CREATE INDEX IF NOT EXISTS "e_pin_audit_logs_epin_id_idx" ON "e_pin_audit_logs"("epin_id");
