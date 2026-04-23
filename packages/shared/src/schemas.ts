import { z } from 'zod';

/**
 * Shared Zod validators used by both the API server (runtime validation) and
 * the web frontend (form validation). Keep these pure — no DB imports.
 */

export const phoneRegex = /^1[3-9]\d{9}$/;

export const LoginRequestSchema = z.object({
  phone: z.string().regex(phoneRegex, 'Invalid Chinese mobile phone number'),
  password: z.string().min(6).max(64),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const CreateCompanySchema = z.object({
  name: z.string().min(1).max(128),
  shortCode: z
    .string()
    .regex(/^[a-z0-9_-]+$/, 'short_code must be lowercase alphanumeric')
    .min(2)
    .max(32)
    .optional(),
  industry: z.enum(['logistics', 'security', 'other']).default('other'),
  contactName: z.string().max(64).optional(),
  contactPhone: z.string().regex(phoneRegex).optional(),
});
export type CreateCompanyInput = z.infer<typeof CreateCompanySchema>;

export const CreateDeviceSchema = z.object({
  lockId: z.string().regex(/^\d{8}$/, 'lockId must be 8 digits (e.g. 60806001)'),
  bleMac: z.string().regex(/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/),
  imei: z
    .string()
    .regex(/^\d{15}$/)
    .optional(),
  modelId: z.number().int().positive(),
  batchId: z.number().int().positive().optional(),
  firmwareVersion: z.string().max(32).optional(),
  loraE220Addr: z.number().int().min(0).max(65535).optional(),
  loraChannel: z.number().int().min(0).max(255).optional(),
});
export type CreateDeviceInput = z.infer<typeof CreateDeviceSchema>;

export const DeploymentInputSchema = z.object({
  deviceId: z.number().int().positive(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().int().nonnegative().optional(),
  doorLabel: z.string().min(1).max(128),
  teamId: z.number().int().positive().optional(),
  photoUrls: z.array(z.string().url()).max(9).optional(),
});
export type DeploymentInput = z.infer<typeof DeploymentInputSchema>;

export const RemoteCommandSchema = z.object({
  deviceId: z.number().int().positive(),
  commandType: z.enum(['unlock', 'lock', 'query_status']),
});
export type RemoteCommandInput = z.infer<typeof RemoteCommandSchema>;

// -------------------- Phase 1: device master data --------------------

export const DeviceStatusEnum = z.enum([
  'manufactured',
  'in_warehouse',
  'shipped',
  'delivered',
  'assigned',
  'active',
  'returned',
  'retired',
]);

export const DeviceCategoryEnum = z.enum(['gps_lock', 'eseal', 'fourg_eseal', 'fourg_padlock']);
export const DeviceSceneEnum = z.enum(['logistics', 'security']);
export const QcStatusEnum = z.enum(['pending', 'passed', 'failed']);

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type Pagination = z.infer<typeof PaginationSchema>;

export const SetPasswordSchema = z.object({
  phone: z.string().regex(phoneRegex),
  password: z.string().min(6).max(64),
  /** One-time setup token for bootstrapping the first vendor admin. Optional for authenticated callers. */
  setupToken: z.string().optional(),
});
export type SetPasswordInput = z.infer<typeof SetPasswordSchema>;

export const CreateDeviceModelSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Z0-9-]+$/, 'code must be uppercase alphanumeric with dashes'),
  name: z.string().min(1).max(128),
  category: DeviceCategoryEnum,
  scene: DeviceSceneEnum,
  hasBle: z.boolean().default(true),
  has4g: z.boolean().default(false),
  hasGps: z.boolean().default(false),
  hasLora: z.boolean().default(false),
  firmwareDefault: z.string().max(32).optional(),
  capabilitiesJson: z.unknown().optional(),
});
export type CreateDeviceModelInput = z.infer<typeof CreateDeviceModelSchema>;

export const CreateBatchSchema = z.object({
  batchNo: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Z0-9-]+$/),
  modelId: z.coerce.number().int().positive(),
  quantity: z.number().int().positive().max(100_000),
  producedAt: z.string().date().optional(),
  remark: z.string().max(2000).optional(),
});
export type CreateBatchInput = z.infer<typeof CreateBatchSchema>;

export const ProductionScanSchema = z.object({
  batchId: z.coerce.number().int().positive(),
  lockId: z.string().regex(/^\d{8}$/),
  bleMac: z.string().regex(/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/),
  imei: z
    .string()
    .regex(/^\d{15}$/)
    .optional(),
  firmwareVersion: z.string().max(32).optional(),
  qcResult: QcStatusEnum.default('passed'),
  qcRemark: z.string().max(255).optional(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type ProductionScanInput = z.infer<typeof ProductionScanSchema>;

export const DeviceListQuerySchema = PaginationSchema.extend({
  status: DeviceStatusEnum.optional(),
  modelId: z.coerce.number().int().positive().optional(),
  ownerCompanyId: z.coerce.number().int().positive().optional(),
  currentTeamId: z.coerce.number().int().positive().optional(),
  search: z.string().max(64).optional(),
});
export type DeviceListQuery = z.infer<typeof DeviceListQuerySchema>;

export const ShipToCompanySchema = z.object({
  deviceIds: z.array(z.coerce.number().int().positive()).min(1).max(1000),
  toCompanyId: z.coerce.number().int().positive(),
  reason: z.string().max(255).optional(),
  shipmentNo: z.string().max(64).optional(),
});
export type ShipToCompanyInput = z.infer<typeof ShipToCompanySchema>;

export const DeliverSchema = z.object({
  deviceIds: z.array(z.coerce.number().int().positive()).min(1).max(1000),
});
export type DeliverInput = z.infer<typeof DeliverSchema>;
