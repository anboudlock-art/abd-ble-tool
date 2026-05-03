-- v2.8.1: structured fault categories for the customer 报修 dropdown.

CREATE TABLE "fault_category" (
    "id" BIGSERIAL NOT NULL,
    "label" VARCHAR(128) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fault_category_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fault_category_is_active_display_order_idx"
  ON "fault_category"("is_active", "display_order");

ALTER TABLE "device_repair"
  ADD COLUMN "fault_category_id" BIGINT;

CREATE INDEX "device_repair_fault_category_id_idx"
  ON "device_repair"("fault_category_id");

ALTER TABLE "device_repair"
  ADD CONSTRAINT "device_repair_fault_category_id_fkey"
  FOREIGN KEY ("fault_category_id") REFERENCES "fault_category"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the v2.8.1 starter fault list. Vendor admin can edit / disable
-- entries later; display_order keeps the dropdown in business-priority
-- order regardless of insert order.
INSERT INTO "fault_category" ("label", "display_order") VALUES
  ('无法开锁',           10),
  ('无法关锁',           20),
  ('电池不充电',         30),
  ('电量异常 / 掉电快',  40),
  ('蓝牙连接失败',       50),
  ('4G 信号弱 / 离线',   60),
  ('GPS 定位不准',       70),
  ('锁体损坏 / 卡死',    80),
  ('外观损坏',           90),
  ('其他',              999);
