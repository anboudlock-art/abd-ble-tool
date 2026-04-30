-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('alarm', 'ship', 'deliver', 'assign', 'remote_command', 'system');

-- CreateTable
CREATE TABLE "notification" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "company_id" BIGINT,
    "kind" "NotificationKind" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(1024) NOT NULL,
    "link" VARCHAR(255),
    "payload" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_created_at_idx" ON "notification"("user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_company_id_created_at_idx" ON "notification"("company_id", "created_at" DESC);
