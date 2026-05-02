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
  /**
   * v2.7: when present, the create-company call also provisions a
   * company_admin user with these credentials so the customer can log in
   * straight away. Phone is required; password is optional (a temp one is
   * generated). The new admin always lands in mustChangePassword=true so
   * the temp password is single-use.
   */
  adminPhone: z.string().regex(phoneRegex).optional(),
  adminName: z.string().min(1).max(64).optional(),
  adminPassword: z.string().min(6).max(64).optional(),
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
  'repairing',
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
  /// Filter by the device's current team's department. Joins device →
  /// team → department.id. Used by the OrgTree drill-down on
  /// /devices/manage.
  currentDepartmentId: z.coerce.number().int().positive().optional(),
  /// Filter by which production batch the device came off.
  batchId: z.coerce.number().int().positive().optional(),
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
  /** Optional: pin the assignment to a specific user inside the team. When
   *  provided, scope is recorded as `user`; otherwise `team`. */
  userId: z.coerce.number().int().positive().optional(),
  /** Optional time window for the permission. */
  validFrom: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional(),
  maxUses: z.coerce.number().int().nonnegative().optional(),
});
export type AssignDevicesInput = z.infer<typeof AssignDevicesSchema>;

/**
 * v2.7 QA P0: bulk authorise N devices to M users in one shot.
 * Each (device, user) pair becomes one user-scope device_assignment.
 * Existing open user-scope grants for the same pair get revoked first
 * so a re-grant updates the validity window cleanly.
 */
export const BulkAuthorizeSchema = z.object({
  deviceIds: z.array(z.coerce.number().int().positive()).min(1).max(1000),
  userIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  reason: z.string().max(255).optional(),
});
export type BulkAuthorizeInput = z.infer<typeof BulkAuthorizeSchema>;

export const DeployDeviceSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.coerce.number().int().nonnegative().optional(),
  doorLabel: z.string().min(1).max(128).optional(),
  photoUrls: z.array(z.string().url()).max(9).optional(),
  /** Optional team to bind the deployment to (defaults to the device's
   *  current team). */
  teamId: z.coerce.number().int().positive().optional(),
});
export type DeployDeviceInput = z.infer<typeof DeployDeviceSchema>;

/**
 * v2.8: caller may pin the transport. 'auto' (default) keeps the
 * server-side picker (LoRa if reachable, else 4G). 'ble' tells the
 * server to skip every gateway downlink — APP will forward over BLE
 * itself and POST /ack when done. 'lora' / 'fourg' force-pick a
 * transport even when the other is also available.
 */
export const DeviceCommandLinkEnum = z.enum(['auto', 'ble', 'lora', 'fourg']);
export type DeviceCommandLinkValue = z.infer<typeof DeviceCommandLinkEnum>;

export const DeviceCommandRequestSchema = z.object({
  commandType: z.enum(['unlock', 'lock', 'query_status']),
  link: DeviceCommandLinkEnum.optional().default('auto'),
  /** Requester's GPS at the moment of asking. Stored on the command row
   *  for audit; the unlock-actually-happened GPS lives on the ack. */
  phoneLat: z.number().min(-90).max(90).optional(),
  phoneLng: z.number().min(-180).max(180).optional(),
  phoneAccuracyM: z.number().int().nonnegative().max(100_000).optional(),
  /** Optional client wall-clock for offline replay. Server clamps to
   *  [now-7d, now+60s] — outside that window the request is rejected
   *  (future) or the value is rewritten to now() (>7d ago). */
  occurredAt: z.string().datetime().optional(),
});
export type DeviceCommandRequestInput = z.infer<typeof DeviceCommandRequestSchema>;

/** v2.8 BLE precheck: APP completes the unlock then PUT/POSTs the
 *  result back. errorMessage required when ok=false. */
export const AckDeviceCommandSchema = z.object({
  ok: z.boolean(),
  errorMessage: z.string().max(255).optional(),
  occurredAt: z.string().datetime(),
  phoneLat: z.number().min(-90).max(90).optional(),
  phoneLng: z.number().min(-180).max(180).optional(),
  phoneAccuracyM: z.number().int().nonnegative().max(100_000).optional(),
});
export type AckDeviceCommandInput = z.infer<typeof AckDeviceCommandSchema>;

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

// -------------------- v2.6 Permission requests + temporary unlock --------------------

/// D1: long-term unlock permission for N devices, partial-approval allowed.
export const CreatePermissionRequestSchema = z.object({
  deviceIds: z.array(z.coerce.number().int().positive()).min(1).max(200),
  reason: z.string().min(1).max(500),
  /// Optional time window the requester wants. null = forever.
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
});
export type CreatePermissionRequestInput = z.infer<typeof CreatePermissionRequestSchema>;

export const PermissionRequestStatusEnum = z.enum([
  'pending',
  'approved',
  'partial',
  'rejected',
  'cancelled',
]);

export const PermissionRequestListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: PermissionRequestStatusEnum.optional(),
  /// "mine" = my own (default for non-admin), "company" = whole company (admins).
  scope: z.enum(['mine', 'company']).default('mine'),
});
export type PermissionRequestListQuery = z.infer<typeof PermissionRequestListQuerySchema>;

/// H2: per-item decision payload. Each entry is one device in the request.
export const ApprovePermissionRequestSchema = z.object({
  /// Per-device decisions. Items the approver doesn't list keep status=pending,
  /// which forces them to come back to it (encourages explicit decisions).
  decisions: z
    .array(
      z.object({
        deviceId: z.coerce.number().int().positive(),
        decision: z.enum(['approve', 'reject']),
      }),
    )
    .min(1),
  decisionNote: z.string().max(500).optional(),
});
export type ApprovePermissionRequestInput = z.infer<typeof ApprovePermissionRequestSchema>;

/// E1: single-device, time-bounded unlock. Window is one of the four steps
/// (1h / 2h / 4h / 8h). emergency=true bumps the request to top of queue
/// and (when SMS is configured) pages approvers.
export const CreateTemporaryUnlockSchema = z.object({
  deviceId: z.coerce.number().int().positive(),
  reason: z.string().min(1).max(500),
  durationMinutes: z.union([
    z.literal(60),
    z.literal(120),
    z.literal(240),
    z.literal(480),
  ]),
  emergency: z.boolean().default(false),
});
export type CreateTemporaryUnlockInput = z.infer<typeof CreateTemporaryUnlockSchema>;

export const TemporaryUnlockStatusEnum = z.enum([
  'pending',
  'approved',
  'rejected',
  'expired',
  'revoked',
  'cancelled',
]);

export const TemporaryUnlockListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: TemporaryUnlockStatusEnum.optional(),
  scope: z.enum(['mine', 'company']).default('mine'),
});
export type TemporaryUnlockListQuery = z.infer<typeof TemporaryUnlockListQuerySchema>;

export const ApproveTemporaryUnlockSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  decisionNote: z.string().max(500).optional(),
});
export type ApproveTemporaryUnlockInput = z.infer<typeof ApproveTemporaryUnlockSchema>;

// -------------------- v2.6 production test (12 items) --------------------

/**
 * Canonical keys for the 12-item production test (v2.6 §2.1).
 *  6 automated + 2 environmental + 4 manual = 12.
 * The set is stable inside one batch but may evolve over time, so we store
 * the test results as JSON keyed by these strings on production_scan.
 */
export const ProductionTestItemKeys = [
  // automated
  'ble_comm',
  '4g_uplink',
  'gps_fix',
  'battery_voltage',
  'power_draw',
  'firmware_version',
  // environmental
  'temp_endurance',
  'waterproof_ip67',
  // manual
  'lock_mechanism',
  'cosmetic',
  'indicator_lamp',
  'accessories',
] as const;
export type ProductionTestItemKey = (typeof ProductionTestItemKeys)[number];

const TestItemResultSchema = z.object({
  pass: z.boolean(),
  /** Optional measured value, e.g. battery=3.84, power=12mA. */
  value: z.union([z.string(), z.number()]).optional(),
  note: z.string().max(255).optional(),
});

export const ProductionTestItemsSchema = z
  .record(z.enum(ProductionTestItemKeys), TestItemResultSchema)
  .refine((v) => Object.keys(v).length > 0, 'at least one test item required');
export type ProductionTestItems = z.infer<typeof ProductionTestItemsSchema>;

/// B2: batch submit production scans. One row per device, allows partial
/// 12-item result via testItems map.
export const BatchProductionScanSchema = z.object({
  scans: z
    .array(
      ProductionScanSchema.extend({
        testItems: ProductionTestItemsSchema.optional(),
      }),
    )
    .min(1)
    .max(500),
});
export type BatchProductionScanInput = z.infer<typeof BatchProductionScanSchema>;

// -------------------- v2.6 lock number generator --------------------

/// 0.2: vendor_admin generates pre-printed lock IDs in batches.
/// `month` 1-12, `year` 4-digit. lockId = (year mod 10) (month%02d) (seq%05d).
export const GenerateLockNumbersSchema = z.object({
  batchId: z.coerce.number().int().positive(),
  year: z.coerce.number().int().min(2024).max(2099),
  month: z.coerce.number().int().min(1).max(12),
  startSeq: z.coerce.number().int().min(1).max(99999).default(1),
  count: z.coerce.number().int().min(1).max(10_000),
});
export type GenerateLockNumbersInput = z.infer<typeof GenerateLockNumbersSchema>;

// -------------------- v2.6 device repair flow --------------------

export const RepairStatusEnum = z.enum([
  'intake',
  'diagnosing',
  'repairing',
  'awaiting_parts',
  'repaired',
  'irreparable',
  'returned',
]);
export type RepairStatusValue = z.infer<typeof RepairStatusEnum>;

export const CreateRepairIntakeSchema = z.object({
  /// Optional — defaults to the device's current owner_company_id.
  sourceCompanyId: z.coerce.number().int().positive().optional(),
  faultReason: z.string().min(1).max(255),
  notes: z.string().max(2000).optional(),
});
export type CreateRepairIntakeInput = z.infer<typeof CreateRepairIntakeSchema>;

export const UpdateRepairStatusSchema = z.object({
  status: z.enum(['diagnosing', 'repairing', 'awaiting_parts', 'repaired', 'irreparable']),
  notes: z.string().max(2000).optional(),
  partsReplaced: z.array(z.string().max(64)).max(50).optional(),
});
export type UpdateRepairStatusInput = z.infer<typeof UpdateRepairStatusSchema>;

export const CloseRepairSchema = z.object({
  /// Where the repaired device should land:
  ///   restore: back to its prior status (default; for repairable cases)
  ///   retire:  device → retired (for irreparable cases)
  resolution: z.enum(['restore', 'retire']).default('restore'),
  notes: z.string().max(2000).optional(),
});
export type CloseRepairInput = z.infer<typeof CloseRepairSchema>;

export const RepairListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: RepairStatusEnum.optional(),
  sourceCompanyId: z.coerce.number().int().positive().optional(),
});
export type RepairListQuery = z.infer<typeof RepairListQuerySchema>;
