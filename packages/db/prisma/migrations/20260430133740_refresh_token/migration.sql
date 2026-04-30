-- CreateTable
CREATE TABLE "refresh_token" (
    "id" BIGSERIAL NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "user_id" BIGINT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "user_agent" VARCHAR(255),
    "client_ip" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_user_id_revoked_at_idx" ON "refresh_token"("user_id", "revoked_at");
