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

export const ChangePasswordSchema = z
  .object({
    oldPassword: z.string().min(1),
    newPassword: z.string().min(6).max(64),
  })
  .refine((v) => v.oldPassword !== v.newPassword, {
    message: '新密码不能和旧密码相同',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

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

// -------------------- Phase 1.5: org management --------------------

export const CreateDepartmentSchema = z.object({
  companyId: z.coerce.number().int().positive(),
  parentId: z.coerce.number().int().positive().optional(),
  name: z.string().min(1).max(128),
  code: z.string().max(32).optional(),
});
export type CreateDepartmentInput = z.infer<typeof CreateDepartmentSchema>;

export const CreateTeamSchema = z.object({
  departmentId: z.coerce.number().int().positive(),
  name: z.string().min(1).max(128),
  leaderUserId: z.coerce.number().int().positive().optional(),
});
export type CreateTeamInput = z.infer<typeof CreateTeamSchema>;

export const CreateUserSchema = z.object({
  companyId: z.coerce.number().int().positive().optional(),
  phone: z.string().regex(phoneRegex),
  name: z.string().min(1).max(64),
  employeeNo: z.string().max(32).optional(),
  email: z.string().email().max(128).optional(),
  role: z.enum([
    'vendor_admin',
    'company_admin',
    'dept_admin',
    'team_leader',
    'member',
    'production_operator',
  ]),
  initialPassword: z.string().min(6).max(64).optional(),
  teamId: z.coerce.number().int().positive().optional(),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const AddTeamMemberSchema = z.object({
  userId: z.coerce.number().int().positive(),
  roleInTeam: z.enum(['leader', 'member']).default('member'),
});
export type AddTeamMemberInput = z.infer<typeof AddTeamMemberSchema>;

export const AssignDevicesSchema = z.object({
  deviceIds: z.array(z.coerce.number().int().positive()).min(1).max(1000),
  teamId: z.coerce.number().int().positive(),
});
export type AssignDevicesInput = z.infer<typeof AssignDevicesSchema>;

export const DeviceCommandRequestSchema = z.object({
  commandType: z.enum(['unlock', 'lock', 'query_status']),
});
export type DeviceCommandRequestInput = z.infer<typeof DeviceCommandRequestSchema>;

// -------------------- Phase 5: integration / webhooks --------------------

export const integrationScopes = [
  'device:read',
  'device:command',
  'event:read',
  'event:webhook',
] as const;
export type IntegrationScope = (typeof integrationScopes)[number];

export const CreateIntegrationAppSchema = z.object({
  name: z.string().min(1).max(128),
  scopes: z.array(z.enum(integrationScopes)).min(1),
  ipWhitelist: z.array(z.string().min(1)).max(32).optional(),
});
export type CreateIntegrationAppInput = z.infer<typeof CreateIntegrationAppSchema>;

export const webhookEventTypes = [
  'lock.opened',
  'lock.closed',
  'lock.tampered',
  'lock.low_battery',
  'lock.offline',
  'lock.online',
  'device.delivered',
  'device.assigned',
  'command.acked',
  'command.timeout',
] as const;
export type WebhookEventType = (typeof webhookEventTypes)[number];

export const CreateWebhookSubscriptionSchema = z.object({
  url: z.string().url().max(512),
  eventTypes: z.array(z.enum(webhookEventTypes)).min(1),
});
export type CreateWebhookSubscriptionInput = z.infer<typeof CreateWebhookSubscriptionSchema>;

// -------------------- Updates (PUT/PATCH) --------------------

export const UpdateDeviceSchema = z.object({
  imei: z.string().regex(/^\d{15}$/).optional().nullable(),
  firmwareVersion: z.string().max(32).optional().nullable(),
  hardwareVersion: z.string().max(32).optional().nullable(),
  doorLabel: z.string().max(128).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  iccid: z.string().regex(/^\d{19,20}$/).optional().nullable(),
  fourgMac: z
    .string()
    .regex(/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/)
    .optional()
    .nullable(),
  secureChipSn: z.string().max(64).optional().nullable(),
  loraE220Addr: z.coerce.number().int().min(0).max(65535).optional().nullable(),
  loraChannel: z.coerce.number().int().min(0).max(255).optional().nullable(),
  loraDevAddr: z.string().regex(/^[0-9A-Fa-f]{8}$/).optional().nullable(),
  loraDevEui: z.string().regex(/^[0-9A-Fa-f]{16}$/).optional().nullable(),
  loraAppKey: z.string().regex(/^[0-9A-Fa-f]{32}$/).optional().nullable(),
  loraAppSKey: z.string().regex(/^[0-9A-Fa-f]{32}$/).optional().nullable(),
  loraNwkSKey: z.string().regex(/^[0-9A-Fa-f]{32}$/).optional().nullable(),
  serverIp: z.string().max(64).optional().nullable(),
  serverPort: z.coerce.number().int().min(1).max(65535).optional().nullable(),
  gatewayId: z.coerce.number().int().positive().optional().nullable(),
});
export type UpdateDeviceInput = z.infer<typeof UpdateDeviceSchema>;

export const UpdateUserSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  email: z.string().email().max(128).optional().nullable(),
  employeeNo: z.string().max(32).optional().nullable(),
  status: z.enum(['active', 'locked']).optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

export const UpdateCompanySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  contactName: z.string().max(64).optional().nullable(),
  contactPhone: z.string().regex(phoneRegex).optional().nullable(),
  industry: z.enum(['logistics', 'security', 'other']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  maxDevices: z.coerce.number().int().positive().optional().nullable(),
});
export type UpdateCompanyInput = z.infer<typeof UpdateCompanySchema>;

export const UpdateBatchSchema = z.object({
  remark: z.string().max(2000).optional().nullable(),
  quantity: z.coerce.number().int().positive().max(100_000).optional(),
});
export type UpdateBatchInput = z.infer<typeof UpdateBatchSchema>;

export const UpdateDepartmentSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  code: z.string().max(32).optional().nullable(),
  parentId: z.coerce.number().int().positive().optional().nullable(),
});
export type UpdateDepartmentInput = z.infer<typeof UpdateDepartmentSchema>;

export const UpdateTeamSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  leaderUserId: z.coerce.number().int().positive().optional().nullable(),
});
export type UpdateTeamInput = z.infer<typeof UpdateTeamSchema>;

// -------------------- Test devices (skip production flow) --------------------

// -------------------- Alarms --------------------

export const AlarmTypeEnum = z.enum([
  'low_battery',
  'offline',
  'tampered',
  'command_timeout',
]);

export const AlarmSeverityEnum = z.enum(['info', 'warning', 'critical']);
export const AlarmStatusEnum = z.enum(['open', 'acknowledged', 'resolved']);

export const AlarmListQuerySchema = PaginationSchema.extend({
  status: AlarmStatusEnum.optional(),
  severity: AlarmSeverityEnum.optional(),
  type: AlarmTypeEnum.optional(),
  deviceId: z.coerce.number().int().positive().optional(),
  since: z.string().datetime().optional(),
});
export type AlarmListQuery = z.infer<typeof AlarmListQuerySchema>;

// -------------------- Test devices (skip production flow) --------------------

export const CreateTestDeviceSchema = z.object({
  lockId: z.string().regex(/^\d{8}$/),
  bleMac: z.string().regex(/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/),
  imei: z.string().regex(/^\d{15}$/).optional(),
  modelId: z.coerce.number().int().positive(),
  firmwareVersion: z.string().max(32).optional(),
  ownerCompanyId: z.coerce.number().int().positive().optional(),
  doorLabel: z.string().max(128).optional(),
  loraE220Addr: z.coerce.number().int().min(0).max(65535).optional(),
  loraChannel: z.coerce.number().int().min(0).max(255).optional(),
  gatewayId: z.coerce.number().int().positive().optional(),
  /** if true, status -> 'active'; otherwise 'in_warehouse' */
  activate: z.boolean().default(true),
});
export type CreateTestDeviceInput = z.infer<typeof CreateTestDeviceSchema>;

// -------------------- OTA / Firmware --------------------

export const FirmwarePackageStatusEnum = z.enum(['draft', 'released', 'archived']);
export const FirmwareTaskStatusEnum = z.enum([
  'queued',
  'pushing',
  'succeeded',
  'failed',
  'cancelled',
]);

export const CreateFirmwarePackageSchema = z.object({
  modelId: z.coerce.number().int().positive(),
  /** semver-ish version, e.g. "1.2.3" or "v10". Unique per modelId. */
  version: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9._+-]+$/, 'version must be alphanumeric / dots / dashes'),
  /** http(s):// or oss:// URL where the binary lives. */
  url: z.string().url().max(512),
  /** lower-case hex SHA-256 of the binary, 64 chars. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lowercase hex chars'),
  sizeBytes: z.coerce.number().int().positive().max(64 * 1024 * 1024),
  changelog: z.string().max(4000).optional(),
  /** Optional company scope; vendor admins can leave null for global. */
  companyId: z.coerce.number().int().positive().optional().nullable(),
});
export type CreateFirmwarePackageInput = z.infer<typeof CreateFirmwarePackageSchema>;

export const FirmwarePackageListQuerySchema = PaginationSchema.extend({
  modelId: z.coerce.number().int().positive().optional(),
  status: FirmwarePackageStatusEnum.optional(),
});
export type FirmwarePackageListQuery = z.infer<typeof FirmwarePackageListQuerySchema>;

export const CreateFirmwareTaskSchema = z.object({
  packageId: z.coerce.number().int().positive(),
  /** One or more devices to push the firmware to. Same model as the package. */
  deviceIds: z.array(z.coerce.number().int().positive()).min(1).max(1000),
  scheduledAt: z.string().datetime().optional(),
});
export type CreateFirmwareTaskInput = z.infer<typeof CreateFirmwareTaskSchema>;
