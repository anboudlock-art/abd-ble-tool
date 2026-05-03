-- CreateEnum
CREATE TYPE "AlarmType" AS ENUM ('low_battery', 'offline', 'tampered', 'command_timeout');

-- CreateEnum
CREATE TYPE "AlarmSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "AlarmStatus" AS ENUM ('open', 'acknowledged', 'resolved');

-- CreateTable
CREATE TABLE "alarm" (
    "id" BIGSERIAL NOT NULL,
    "ulid" TEXT NOT NULL,
    "company_id" BIGINT,
    "device_id" BIGINT NOT NULL,
    "type" "AlarmType" NOT NULL,
    "severity" "AlarmSeverity" NOT NULL DEFAULT 'warning',
    "status" "AlarmStatus" NOT NULL DEFAULT 'open',
    "message" VARCHAR(255) NOT NULL,
    "payload" JSONB,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggered_event_id" BIGINT,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_user_id" BIGINT,
    "resolved_at" TIMESTAMP(3),
    "dedup_key" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alarm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "alarm_ulid_key" ON "alarm"("ulid");

-- CreateIndex
CREATE INDEX "alarm_company_id_status_triggered_at_idx" ON "alarm"("company_id", "status", "triggered_at" DESC);

-- CreateIndex
CREATE INDEX "alarm_device_id_triggered_at_idx" ON "alarm"("device_id", "triggered_at" DESC);

-- CreateIndex
CREATE INDEX "alarm_dedup_key_idx" ON "alarm"("dedup_key");
