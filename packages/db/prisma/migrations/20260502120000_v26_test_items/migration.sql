-- v2.6 batch 3: 12-item test results stored on production_scan as JSONB.
ALTER TABLE "production_scan" ADD COLUMN "test_items" JSONB;
