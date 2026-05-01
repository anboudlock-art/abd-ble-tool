-- v2.6 foundation: repairing status + 5 new tables
-- (lock_number, device_repair, permission_request,
--  permission_request_item, temporary_unlock)

-- AlterEnum: add `repairing` to DeviceStatus
ALTER TYPE "DeviceStatus" ADD VALUE 'repairing' AFTER 'active';

-- CreateEnums
CREATE TYPE "LockNumberStatus" AS ENUM ('reserved', 'registered', 'voided');

CREATE TYPE "RepairStatus" AS ENUM (
  'intake', 'diagnosing', 'repairing', 'awaiting_parts',
  'repaired', 'irreparable', 'returned'
);

CREATE TYPE "PermissionRequestStatus" AS ENUM (
  'pending', 'approved', 'partial', 'rejected', 'cancelled'
);

CREATE TYPE "PermissionRequestItemStatus" AS ENUM (
  'pending', 'approved', 'rejected'
);

CREATE TYPE "TemporaryUnlockStatus" AS ENUM (
  'pending', 'approved', 'rejected', 'expired', 'revoked', 'cancelled'
);

-- ----------------------------------------------------------
-- lock_number
-- ----------------------------------------------------------
CREATE TABLE "lock_number" (
    "id" BIGSERIAL NOT NULL,
    "lock_id" VARCHAR(32) NOT NULL,
    "batch_id" BIGINT NOT NULL,
    "status" "LockNumberStatus" NOT NULL DEFAULT 'reserved',
    "device_id" BIGINT,
    "void_reason" VARCHAR(128),
    "generated_by_user_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registered_at" TIMESTAMP(3),

    CONSTRAINT "lock_number_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lock_number_lock_id_key" ON "lock_number"("lock_id");
CREATE UNIQUE INDEX "lock_number_device_id_key" ON "lock_number"("device_id");
CREATE INDEX "lock_number_batch_id_idx" ON "lock_number"("batch_id");
CREATE INDEX "lock_number_status_idx" ON "lock_number"("status");
ALTER TABLE "lock_number"
  ADD CONSTRAINT "lock_number_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "production_batch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------
-- device_repair
-- ----------------------------------------------------------
CREATE TABLE "device_repair" (
    "id" BIGSERIAL NOT NULL,
    "ulid" TEXT NOT NULL,
    "device_id" BIGINT NOT NULL,
    "source_company_id" BIGINT,
    "prior_status" "DeviceStatus" NOT NULL,
    "fault_reason" VARCHAR(255) NOT NULL,
    "status" "RepairStatus" NOT NULL DEFAULT 'intake',
    "intake_by_user_id" BIGINT,
    "repaired_by_user_id" BIGINT,
    "notes" TEXT,
    "parts_replaced" JSONB,
    "intake_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repaired_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "device_repair_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "device_repair_ulid_key" ON "device_repair"("ulid");
CREATE INDEX "device_repair_device_id_intake_at_idx"
  ON "device_repair"("device_id", "intake_at" DESC);
CREATE INDEX "device_repair_status_idx" ON "device_repair"("status");
CREATE INDEX "device_repair_source_company_id_idx"
  ON "device_repair"("source_company_id");
ALTER TABLE "device_repair"
  ADD CONSTRAINT "device_repair_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "device"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_repair"
  ADD CONSTRAINT "device_repair_source_company_id_fkey"
  FOREIGN KEY ("source_company_id") REFERENCES "company"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------
-- permission_request
-- ----------------------------------------------------------
CREATE TABLE "permission_request" (
    "id" BIGSERIAL NOT NULL,
    "ulid" TEXT NOT NULL,
    "applicant_user_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "status" "PermissionRequestStatus" NOT NULL DEFAULT 'pending',
    "decided_by_user_id" BIGINT,
    "decided_at" TIMESTAMP(3),
    "decision_note" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permission_request_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "permission_request_ulid_key" ON "permission_request"("ulid");
CREATE INDEX "permission_request_company_id_status_created_at_idx"
  ON "permission_request"("company_id", "status", "created_at" DESC);
CREATE INDEX "permission_request_applicant_user_id_created_at_idx"
  ON "permission_request"("applicant_user_id", "created_at" DESC);
ALTER TABLE "permission_request"
  ADD CONSTRAINT "permission_request_applicant_user_id_fkey"
  FOREIGN KEY ("applicant_user_id") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "permission_request"
  ADD CONSTRAINT "permission_request_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------
-- permission_request_item
-- ----------------------------------------------------------
CREATE TABLE "permission_request_item" (
    "id" BIGSERIAL NOT NULL,
    "request_id" BIGINT NOT NULL,
    "device_id" BIGINT NOT NULL,
    "status" "PermissionRequestItemStatus" NOT NULL DEFAULT 'pending',
    "assignment_id" BIGINT,

    CONSTRAINT "permission_request_item_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "permission_request_item_request_id_device_id_key"
  ON "permission_request_item"("request_id", "device_id");
CREATE INDEX "permission_request_item_device_id_idx"
  ON "permission_request_item"("device_id");
ALTER TABLE "permission_request_item"
  ADD CONSTRAINT "permission_request_item_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "permission_request"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "permission_request_item"
  ADD CONSTRAINT "permission_request_item_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "device"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------
-- temporary_unlock
-- ----------------------------------------------------------
CREATE TABLE "temporary_unlock" (
    "id" BIGSERIAL NOT NULL,
    "ulid" TEXT NOT NULL,
    "applicant_user_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "device_id" BIGINT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "status" "TemporaryUnlockStatus" NOT NULL DEFAULT 'pending',
    "approved_at" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "decided_by_user_id" BIGINT,
    "decision_note" VARCHAR(500),
    "assignment_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "temporary_unlock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "temporary_unlock_ulid_key" ON "temporary_unlock"("ulid");
CREATE INDEX "temporary_unlock_company_id_status_emergency_created_at_idx"
  ON "temporary_unlock"("company_id", "status", "emergency", "created_at" DESC);
CREATE INDEX "temporary_unlock_applicant_user_id_created_at_idx"
  ON "temporary_unlock"("applicant_user_id", "created_at" DESC);
CREATE INDEX "temporary_unlock_valid_until_idx"
  ON "temporary_unlock"("valid_until");
ALTER TABLE "temporary_unlock"
  ADD CONSTRAINT "temporary_unlock_applicant_user_id_fkey"
  FOREIGN KEY ("applicant_user_id") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "temporary_unlock"
  ADD CONSTRAINT "temporary_unlock_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "temporary_unlock"
  ADD CONSTRAINT "temporary_unlock_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "device"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
