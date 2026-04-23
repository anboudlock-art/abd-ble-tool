-- CreateEnum
CREATE TYPE "Industry" AS ENUM ('logistics', 'security', 'other');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "CompanyPlan" AS ENUM ('trial', 'standard', 'enterprise');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('vendor_admin', 'company_admin', 'dept_admin', 'team_leader', 'member', 'production_operator');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'locked', 'invited');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('leader', 'member');

-- CreateEnum
CREATE TYPE "DeviceCategory" AS ENUM ('gps_lock', 'eseal', 'fourg_eseal', 'fourg_padlock');

-- CreateEnum
CREATE TYPE "DeviceScene" AS ENUM ('logistics', 'security');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('manufactured', 'in_warehouse', 'shipped', 'delivered', 'assigned', 'active', 'returned', 'retired');

-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('vendor', 'company');

-- CreateEnum
CREATE TYPE "LockState" AS ENUM ('opened', 'closed', 'tampered', 'unknown');

-- CreateEnum
CREATE TYPE "QcStatus" AS ENUM ('pending', 'passed', 'failed');

-- CreateEnum
CREATE TYPE "AssignmentScope" AS ENUM ('company', 'team', 'user');

-- CreateEnum
CREATE TYPE "GatewayStatus" AS ENUM ('provisioning', 'active', 'suspended', 'retired');

-- CreateEnum
CREATE TYPE "LockEventType" AS ENUM ('opened', 'closed', 'tampered', 'heartbeat', 'low_battery', 'offline', 'online');

-- CreateEnum
CREATE TYPE "LockEventSource" AS ENUM ('ble', 'lora', 'fourg', 'system');

-- CreateEnum
CREATE TYPE "DeviceCommandType" AS ENUM ('unlock', 'lock', 'query_status', 'config_network');

-- CreateEnum
CREATE TYPE "DeviceCommandSource" AS ENUM ('web', 'app', 'api');

-- CreateEnum
CREATE TYPE "DeviceCommandStatus" AS ENUM ('pending', 'sent', 'acked', 'timeout', 'failed');

-- CreateEnum
CREATE TYPE "IntegrationAppStatus" AS ENUM ('active', 'revoked');

-- CreateTable
CREATE TABLE "company" (
    "id" BIGSERIAL NOT NULL,
    "ulid" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "short_code" VARCHAR(32),
    "industry" "Industry" NOT NULL DEFAULT 'other',
    "contact_name" VARCHAR(64),
    "contact_phone" VARCHAR(32),
    "status" "CompanyStatus" NOT NULL DEFAULT 'active',
    "plan" "CompanyPlan" NOT NULL DEFAULT 'trial',
    "max_devices" INTEGER,
    "created_by_user_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" BIGSERIAL NOT NULL,
    "ulid" TEXT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "parent_id" BIGINT,
    "name" VARCHAR(128) NOT NULL,
    "code" VARCHAR(32),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team" (
    "id" BIGSERIAL NOT NULL,
    "ulid" TEXT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "department_id" BIGINT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "leader_user_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" BIGSERIAL NOT NULL,
    "ulid" TEXT NOT NULL,
    "company_id" BIGINT,
    "phone" VARCHAR(32) NOT NULL,
    "email" VARCHAR(128),
    "name" VARCHAR(64) NOT NULL,
    "employee_no" VARCHAR(32),
    "password_hash" VARCHAR(255),
    "role" "UserRole" NOT NULL DEFAULT 'member',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMP(3),
    "avatar_url" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_membership" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "team_id" BIGINT NOT NULL,
    "role_in_team" "TeamRole" NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_model" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "category" "DeviceCategory" NOT NULL,
    "scene" "DeviceScene" NOT NULL,
    "has_ble" BOOLEAN NOT NULL DEFAULT true,
    "has_4g" BOOLEAN NOT NULL DEFAULT false,
    "has_gps" BOOLEAN NOT NULL DEFAULT false,
    "has_lora" BOOLEAN NOT NULL DEFAULT false,
    "firmware_default" VARCHAR(32),
    "capabilities_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device" (
    "id" BIGSERIAL NOT NULL,
    "ulid" TEXT NOT NULL,
    "lock_id" VARCHAR(32) NOT NULL,
    "ble_mac" VARCHAR(17) NOT NULL,
    "imei" VARCHAR(20),
    "model_id" BIGINT NOT NULL,
    "batch_id" BIGINT,
    "firmware_version" VARCHAR(32),
    "qc_status" "QcStatus" NOT NULL DEFAULT 'pending',
    "produced_at" TIMESTAMP(3),
    "status" "DeviceStatus" NOT NULL DEFAULT 'manufactured',
    "owner_type" "OwnerType" NOT NULL DEFAULT 'vendor',
    "owner_company_id" BIGINT,
    "current_team_id" BIGINT,
    "location_lat" DECIMAL(10,7),
    "location_lng" DECIMAL(10,7),
    "location_accuracy_m" INTEGER,
    "door_label" VARCHAR(128),
    "deployed_at" TIMESTAMP(3),
    "deployed_by_user_id" BIGINT,
    "last_state" "LockState" NOT NULL DEFAULT 'unknown',
    "last_battery" SMALLINT,
    "last_seen_at" TIMESTAMP(3),
    "gateway_id" BIGINT,
    "lora_e220_addr" INTEGER,
    "lora_channel" SMALLINT,
    "server_ip" VARCHAR(64),
    "server_port" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_batch" (
    "id" BIGSERIAL NOT NULL,
    "ulid" TEXT NOT NULL,
    "batch_no" VARCHAR(32) NOT NULL,
    "model_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "produced_count" INTEGER NOT NULL DEFAULT 0,
    "produced_at" DATE,
    "operator_user_id" BIGINT,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_transfer" (
    "id" BIGSERIAL NOT NULL,
    "device_id" BIGINT NOT NULL,
    "from_status" "DeviceStatus" NOT NULL,
    "to_status" "DeviceStatus" NOT NULL,
    "from_owner_type" "OwnerType",
    "from_owner_id" BIGINT,
    "to_owner_type" "OwnerType",
    "to_owner_id" BIGINT,
    "operator_user_id" BIGINT,
    "reason" VARCHAR(255),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_deployment" (
    "id" BIGSERIAL NOT NULL,
    "device_id" BIGINT NOT NULL,
    "operator_user_id" BIGINT NOT NULL,
    "team_id" BIGINT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "accuracy_m" INTEGER,
    "door_label" VARCHAR(128),
    "photo_urls" JSONB,
    "deployed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_assignment" (
    "id" BIGSERIAL NOT NULL,
    "device_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "scope" "AssignmentScope" NOT NULL,
    "team_id" BIGINT,
    "user_id" BIGINT,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "granted_by_user_id" BIGINT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway" (
    "id" BIGSERIAL NOT NULL,
    "ulid" TEXT NOT NULL,
    "gw_id" VARCHAR(16) NOT NULL,
    "token" VARCHAR(32) NOT NULL,
    "company_id" BIGINT,
    "model" VARCHAR(64) NOT NULL DEFAULT 'E90-DTU(900SL22-GPRS)',
    "location_lat" DECIMAL(10,7),
    "location_lng" DECIMAL(10,7),
    "location_note" VARCHAR(255),
    "lora_freq_band" SMALLINT,
    "lora_channel" SMALLINT,
    "status" "GatewayStatus" NOT NULL DEFAULT 'provisioning',
    "last_seen_at" TIMESTAMP(3),
    "online" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gateway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_session" (
    "id" BIGSERIAL NOT NULL,
    "gateway_id" BIGINT NOT NULL,
    "client_ip" VARCHAR(64) NOT NULL,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnected_at" TIMESTAMP(3),
    "disconnect_reason" VARCHAR(128),

    CONSTRAINT "gateway_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lock_event" (
    "id" BIGSERIAL NOT NULL,
    "device_id" BIGINT NOT NULL,
    "company_id" BIGINT,
    "event_type" "LockEventType" NOT NULL,
    "source" "LockEventSource" NOT NULL,
    "battery" SMALLINT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "gateway_id" BIGINT,
    "operator_user_id" BIGINT,
    "raw_payload" BYTEA,
    "dedup_key" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lock_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_command" (
    "id" BIGSERIAL NOT NULL,
    "device_id" BIGINT NOT NULL,
    "command_type" "DeviceCommandType" NOT NULL,
    "issued_by_user_id" BIGINT NOT NULL,
    "source" "DeviceCommandSource" NOT NULL,
    "gateway_id" BIGINT,
    "request_payload" BYTEA,
    "status" "DeviceCommandStatus" NOT NULL DEFAULT 'pending',
    "retries" SMALLINT NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "acked_at" TIMESTAMP(3),
    "timeout_at" TIMESTAMP(3),
    "result_event_id" BIGINT,
    "error_message" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_scan" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" BIGINT,
    "device_id" BIGINT,
    "operator_user_id" BIGINT,
    "qr_scanned" VARCHAR(64),
    "ble_mac_read" VARCHAR(17),
    "imei_read" VARCHAR(20),
    "firmware_version_read" VARCHAR(32),
    "qc_result" "QcStatus" NOT NULL DEFAULT 'pending',
    "qc_remark" VARCHAR(255),
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER,

    CONSTRAINT "production_scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_app" (
    "id" BIGSERIAL NOT NULL,
    "ulid" TEXT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "app_key" VARCHAR(32) NOT NULL,
    "app_secret_hash" VARCHAR(255) NOT NULL,
    "scopes" JSONB NOT NULL,
    "ip_whitelist" JSONB,
    "status" "IntegrationAppStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "integration_app_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscription" (
    "id" BIGSERIAL NOT NULL,
    "integration_app_id" BIGINT NOT NULL,
    "url" VARCHAR(512) NOT NULL,
    "event_types" JSONB NOT NULL,
    "secret" VARCHAR(64) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_success_at" TIMESTAMP(3),
    "last_failure_at" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery" (
    "id" BIGSERIAL NOT NULL,
    "subscription_id" BIGINT NOT NULL,
    "event_id" BIGINT NOT NULL,
    "http_status" SMALLINT,
    "response_body" TEXT,
    "duration_ms" INTEGER,
    "attempt" SMALLINT NOT NULL DEFAULT 1,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT,
    "actor_user_id" BIGINT,
    "actor_ip" VARCHAR(64),
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(32),
    "target_id" BIGINT,
    "diff" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "id" BIGSERIAL NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_ulid_key" ON "company"("ulid");

-- CreateIndex
CREATE UNIQUE INDEX "company_short_code_key" ON "company"("short_code");

-- CreateIndex
CREATE INDEX "company_status_idx" ON "company"("status");

-- CreateIndex
CREATE UNIQUE INDEX "department_ulid_key" ON "department"("ulid");

-- CreateIndex
CREATE INDEX "department_company_id_idx" ON "department"("company_id");

-- CreateIndex
CREATE INDEX "department_parent_id_idx" ON "department"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_ulid_key" ON "team"("ulid");

-- CreateIndex
CREATE INDEX "team_company_id_idx" ON "team"("company_id");

-- CreateIndex
CREATE INDEX "team_department_id_idx" ON "team"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_ulid_key" ON "user"("ulid");

-- CreateIndex
CREATE UNIQUE INDEX "user_phone_key" ON "user"("phone");

-- CreateIndex
CREATE INDEX "user_company_id_idx" ON "user"("company_id");

-- CreateIndex
CREATE INDEX "user_role_idx" ON "user"("role");

-- CreateIndex
CREATE INDEX "user_membership_team_id_idx" ON "user_membership"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_membership_user_id_team_id_key" ON "user_membership"("user_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_model_code_key" ON "device_model"("code");

-- CreateIndex
CREATE UNIQUE INDEX "device_ulid_key" ON "device"("ulid");

-- CreateIndex
CREATE UNIQUE INDEX "device_lock_id_key" ON "device"("lock_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_ble_mac_key" ON "device"("ble_mac");

-- CreateIndex
CREATE UNIQUE INDEX "device_imei_key" ON "device"("imei");

-- CreateIndex
CREATE INDEX "device_status_idx" ON "device"("status");

-- CreateIndex
CREATE INDEX "device_owner_company_id_status_idx" ON "device"("owner_company_id", "status");

-- CreateIndex
CREATE INDEX "device_current_team_id_idx" ON "device"("current_team_id");

-- CreateIndex
CREATE INDEX "device_gateway_id_idx" ON "device"("gateway_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_batch_ulid_key" ON "production_batch"("ulid");

-- CreateIndex
CREATE UNIQUE INDEX "production_batch_batch_no_key" ON "production_batch"("batch_no");

-- CreateIndex
CREATE INDEX "device_transfer_device_id_created_at_idx" ON "device_transfer"("device_id", "created_at");

-- CreateIndex
CREATE INDEX "device_deployment_device_id_deployed_at_idx" ON "device_deployment"("device_id", "deployed_at");

-- CreateIndex
CREATE INDEX "device_assignment_device_id_revoked_at_idx" ON "device_assignment"("device_id", "revoked_at");

-- CreateIndex
CREATE INDEX "device_assignment_team_id_idx" ON "device_assignment"("team_id");

-- CreateIndex
CREATE INDEX "device_assignment_user_id_idx" ON "device_assignment"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_ulid_key" ON "gateway"("ulid");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_gw_id_key" ON "gateway"("gw_id");

-- CreateIndex
CREATE INDEX "gateway_company_id_idx" ON "gateway"("company_id");

-- CreateIndex
CREATE INDEX "gateway_online_idx" ON "gateway"("online");

-- CreateIndex
CREATE INDEX "gateway_session_gateway_id_connected_at_idx" ON "gateway_session"("gateway_id", "connected_at");

-- CreateIndex
CREATE INDEX "lock_event_device_id_created_at_idx" ON "lock_event"("device_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "lock_event_company_id_created_at_idx" ON "lock_event"("company_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "lock_event_event_type_created_at_idx" ON "lock_event"("event_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "lock_event_dedup_key_idx" ON "lock_event"("dedup_key");

-- CreateIndex
CREATE INDEX "device_command_device_id_created_at_idx" ON "device_command"("device_id", "created_at");

-- CreateIndex
CREATE INDEX "device_command_status_timeout_at_idx" ON "device_command"("status", "timeout_at");

-- CreateIndex
CREATE INDEX "production_scan_batch_id_idx" ON "production_scan"("batch_id");

-- CreateIndex
CREATE INDEX "production_scan_scanned_at_idx" ON "production_scan"("scanned_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_app_ulid_key" ON "integration_app"("ulid");

-- CreateIndex
CREATE UNIQUE INDEX "integration_app_app_key_key" ON "integration_app"("app_key");

-- CreateIndex
CREATE INDEX "integration_app_company_id_idx" ON "integration_app"("company_id");

-- CreateIndex
CREATE INDEX "webhook_subscription_integration_app_id_idx" ON "webhook_subscription"("integration_app_id");

-- CreateIndex
CREATE INDEX "webhook_delivery_subscription_id_sent_at_idx" ON "webhook_delivery"("subscription_id", "sent_at");

-- CreateIndex
CREATE INDEX "audit_log_company_id_created_at_idx" ON "audit_log"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_created_at_idx" ON "audit_log"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_action_created_at_idx" ON "audit_log"("action", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_config_key_key" ON "system_config"("key");

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_membership" ADD CONSTRAINT "user_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_membership" ADD CONSTRAINT "user_membership_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "device_model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "production_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_owner_company_id_fkey" FOREIGN KEY ("owner_company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_current_team_id_fkey" FOREIGN KEY ("current_team_id") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "gateway"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "device_model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_transfer" ADD CONSTRAINT "device_transfer_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_deployment" ADD CONSTRAINT "device_deployment_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_deployment" ADD CONSTRAINT "device_deployment_operator_user_id_fkey" FOREIGN KEY ("operator_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_deployment" ADD CONSTRAINT "device_deployment_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignment" ADD CONSTRAINT "device_assignment_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignment" ADD CONSTRAINT "device_assignment_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignment" ADD CONSTRAINT "device_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignment" ADD CONSTRAINT "device_assignment_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway" ADD CONSTRAINT "gateway_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_session" ADD CONSTRAINT "gateway_session_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "gateway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lock_event" ADD CONSTRAINT "lock_event_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lock_event" ADD CONSTRAINT "lock_event_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "gateway"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "gateway"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_result_event_id_fkey" FOREIGN KEY ("result_event_id") REFERENCES "lock_event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_scan" ADD CONSTRAINT "production_scan_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "production_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_scan" ADD CONSTRAINT "production_scan_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_app" ADD CONSTRAINT "integration_app_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscription" ADD CONSTRAINT "webhook_subscription_integration_app_id_fkey" FOREIGN KEY ("integration_app_id") REFERENCES "integration_app"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
