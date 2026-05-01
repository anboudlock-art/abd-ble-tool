-- CreateEnum
CREATE TYPE "FirmwarePackageStatus" AS ENUM ('draft', 'released', 'archived');

-- CreateEnum
CREATE TYPE "FirmwareTaskStatus" AS ENUM ('queued', 'pushing', 'succeeded', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "firmware_package" (
    "id" BIGSERIAL NOT NULL,
    "ulid" TEXT NOT NULL,
    "company_id" BIGINT,
    "model_id" BIGINT NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "url" VARCHAR(512) NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "changelog" TEXT,
    "status" "FirmwarePackageStatus" NOT NULL DEFAULT 'draft',
    "uploaded_by_user_id" BIGINT,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "firmware_package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_firmware_task" (
    "id" BIGSERIAL NOT NULL,
    "package_id" BIGINT NOT NULL,
    "device_id" BIGINT NOT NULL,
    "status" "FirmwareTaskStatus" NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error_message" VARCHAR(255),
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "triggered_by_user_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_firmware_task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "firmware_package_ulid_key" ON "firmware_package"("ulid");

-- CreateIndex
CREATE UNIQUE INDEX "firmware_package_model_id_version_key" ON "firmware_package"("model_id", "version");

-- CreateIndex
CREATE INDEX "firmware_package_company_id_idx" ON "firmware_package"("company_id");

-- CreateIndex
CREATE INDEX "firmware_package_status_idx" ON "firmware_package"("status");

-- CreateIndex
CREATE UNIQUE INDEX "device_firmware_task_package_id_device_id_key" ON "device_firmware_task"("package_id", "device_id");

-- CreateIndex
CREATE INDEX "device_firmware_task_device_id_created_at_idx" ON "device_firmware_task"("device_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "device_firmware_task_status_idx" ON "device_firmware_task"("status");

-- AddForeignKey
ALTER TABLE "firmware_package" ADD CONSTRAINT "firmware_package_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "device_model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_firmware_task" ADD CONSTRAINT "device_firmware_task_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "firmware_package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
