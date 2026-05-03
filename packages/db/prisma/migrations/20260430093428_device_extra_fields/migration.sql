-- AlterTable
ALTER TABLE "device" ADD COLUMN     "fourg_mac" VARCHAR(17),
ADD COLUMN     "hardware_version" VARCHAR(32),
ADD COLUMN     "iccid" VARCHAR(20),
ADD COLUMN     "lora_app_key" VARCHAR(32),
ADD COLUMN     "lora_app_skey" VARCHAR(32),
ADD COLUMN     "lora_dev_addr" VARCHAR(8),
ADD COLUMN     "lora_dev_eui" VARCHAR(16),
ADD COLUMN     "lora_nwk_skey" VARCHAR(32),
ADD COLUMN     "secure_chip_sn" VARCHAR(64);
