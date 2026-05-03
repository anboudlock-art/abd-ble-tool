-- AlterTable
ALTER TABLE "production_batch" ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "completed_by_user_id" BIGINT;
