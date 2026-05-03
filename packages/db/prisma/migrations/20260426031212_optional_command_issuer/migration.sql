-- DropForeignKey
ALTER TABLE "device_command" DROP CONSTRAINT "device_command_issued_by_user_id_fkey";

-- AlterTable
ALTER TABLE "device_command" ALTER COLUMN "issued_by_user_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
