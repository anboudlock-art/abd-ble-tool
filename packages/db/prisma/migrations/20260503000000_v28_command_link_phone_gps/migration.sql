-- v2.8 batch 1: device_command extended for BLE-precheck flow.
--   - link enum (auto/ble/lora/fourg) records which transport carried it
--   - phone_lat/lng/m: requester's GPS at command creation
--   - ack_phone_lat/lng/m: APP's GPS at unlock-ack moment
--   - occurred_at: client-supplied wall-clock for offline replay
--   - server_note: free-form audit when server rewrites client data

-- CreateEnum
CREATE TYPE "DeviceCommandLink" AS ENUM ('auto', 'ble', 'lora', 'fourg');

-- AlterTable
ALTER TABLE "device_command"
  ADD COLUMN "link" "DeviceCommandLink" NOT NULL DEFAULT 'auto',
  ADD COLUMN "phone_lat" DECIMAL(10, 7),
  ADD COLUMN "phone_lng" DECIMAL(10, 7),
  ADD COLUMN "phone_accuracy_m" INTEGER,
  ADD COLUMN "ack_phone_lat" DECIMAL(10, 7),
  ADD COLUMN "ack_phone_lng" DECIMAL(10, 7),
  ADD COLUMN "ack_phone_accuracy_m" INTEGER,
  ADD COLUMN "occurred_at" TIMESTAMP(3),
  ADD COLUMN "server_note" VARCHAR(255);
