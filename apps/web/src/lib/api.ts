/**
 * Tiny fetch wrapper for the @abd/api backend.
 * Auto-injects bearer token from localStorage and surfaces JSON errors.
 */

const TOKEN_KEY = 'abd:access_token';
const REFRESH_TOKEN_KEY = 'abd:refresh_token';
const VIEW_AS_KEY = 'abd:view_as_company';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export const tokenStorage = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TOKEN_KEY, token);
  },
  getRefresh(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  setRefresh(refreshToken: string) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  },
  clear() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    window.localStorage.removeItem(VIEW_AS_KEY);
  },
};

/**
 * v2.7 vendor "view-as-company": when a vendor_admin selects a customer
 * from the sidebar switcher we stash the id here. Every outgoing API
 * request then carries it as X-View-As-Company so the backend can scope
 * results to that company.
 */
export const viewAsStorage = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(VIEW_AS_KEY);
  },
  set(companyId: string | null) {
    if (typeof window === 'undefined') return;
    if (companyId) window.localStorage.setItem(VIEW_AS_KEY, companyId);
    else window.localStorage.removeItem(VIEW_AS_KEY);
    // Cross-tab + same-tab broadcast so React components can react.
    window.dispatchEvent(new CustomEvent('abd:view-as-changed'));
  },
};

/**
 * Single in-flight refresh promise to prevent stampedes when many requests
 * 401 simultaneously.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = tokenStorage.getRefresh();
  if (!refreshToken) return null;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(
        (baseUrl || '') + '/api/v1/auth/refresh',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        },
      );
      if (!res.ok) {
        tokenStorage.clear();
        return null;
      }
      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      tokenStorage.set(data.accessToken);
      tokenStorage.setRefresh(data.refreshToken);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// 当 NEXT_PUBLIC_API_BASE_URL 未设置或为空时，使用空字符串（走相对路径通过 Nginx 反代）
// 绝不 fallback 到 localhost，因为 localhost 在浏览器端指向用户本地机器
const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';

/**
 * Fetch a binary/text file (e.g. CSV export) with the bearer token,
 * then trigger a browser download. Bypasses JSON parsing and runs
 * outside React Query.
 */
export async function downloadFile(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
  filename = 'download',
): Promise<void> {
  const headers = new Headers({ Accept: '*/*' });
  const token = tokenStorage.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const viewAs = viewAsStorage.get();
  if (viewAs) headers.set('X-View-As-Company', viewAs);

  const url = new URL(
    path.startsWith('http') ? path : (baseUrl || '') + path,
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
  );
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiClientError(res.status, {
      code: 'DOWNLOAD_FAILED',
      message: body || `HTTP ${res.status}`,
    });
  }
  const blob = await res.blob();
  // Server may set Content-Disposition; honour that filename if present.
  const dispo = res.headers.get('Content-Disposition');
  const m = dispo?.match(/filename="?([^"]+)"?/);
  const finalName = m?.[1] ?? filename;

  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

export interface ApiRequestInit extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** internal: prevent infinite refresh-retry loop */
  __retried?: boolean;
}

export async function apiRequest<T = unknown>(
  path: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  headers.set('Accept', 'application/json');
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const token = tokenStorage.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // Vendor "view-as-company" — backend's scopeToCompany() ignores this
  // header for non-vendor users, so it's safe to attach unconditionally.
  const viewAs = viewAsStorage.get();
  if (viewAs) headers.set('X-View-As-Company', viewAs);

  let url: string;
  if (path.startsWith('http')) {
    url = path;
  } else if (!baseUrl) {
    // 空 baseUrl → 相对路径，直接用（Nginx 反代模式）
    url = path;
  } else {
    url = new URL(baseUrl + path).toString();
  }
  if (init.query) {
    const u = new URL(url, 'http://localhost');
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    }
    url = u.pathname + u.search;
  }

  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers,
    credentials: 'omit',
    body:
      init.body === undefined
        ? undefined
        : init.body instanceof FormData
          ? init.body
          : JSON.stringify(init.body),
  });

  // 204
  if (res.status === 204) return undefined as T;

  let parsed: unknown = undefined;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiClientError(res.status, {
        code: 'BAD_RESPONSE',
        message: `Non-JSON response (status ${res.status})`,
      });
    }
  }

  if (!res.ok) {
    const body =
      parsed && typeof parsed === 'object'
        ? (parsed as ApiErrorBody)
        : { code: 'HTTP_ERROR', message: `HTTP ${res.status}` };

    // 401 → try once to refresh and retry. The refresh endpoint itself is
    // exempt to avoid an infinite loop.
    const isRefreshCall = path.includes('/auth/refresh');
    if (res.status === 401 && !isRefreshCall && !init.__retried) {
      const newToken = await tryRefresh();
      if (newToken) {
        return apiRequest(path, { ...init, __retried: true } as ApiRequestInit);
      }
      tokenStorage.clear();
    }
    throw new ApiClientError(res.status, body);
  }

  return parsed as T;
}

// ----- Typed endpoints (subset; expand as needed) -----

export interface User {
  id: string;
  name: string;
  phone: string;
  role: string;
  companyId: string | null;
  mustChangePassword: boolean;
}

export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    name: string;
    role: string;
    companyId: string | null;
    mustChangePassword: boolean;
  };
}

export interface Device {
  id: string;
  lockId: string;
  bleMac: string;
  imei: string | null;
  // v2.8 batch 1 surface added these fields server-side; expose them
  // to consumers (RemoteControl, /devices/manage table, the APP via
  // /users/me/devices) so they can render per-capability buttons.
  model:
    | {
        id: string;
        code: string;
        name: string;
        category?: string | null;
        hasBle?: boolean | null;
        has4g?: boolean | null;
        hasGps?: boolean | null;
        hasLora?: boolean | null;
        capabilitiesJson?: unknown;
      }
    | null;
  gatewayId?: string | null;
  gatewayOnline?: boolean | null;
  firmwareVersion: string | null;
  hardwareVersion: string | null;
  qcStatus: string;
  status: string;
  ownerType: string;
  ownerCompanyId: string | null;
  ownerCompanyName: string | null;
  currentTeamId: string | null;
  currentTeamName: string | null;
  lastState: string;
  lastBattery: number | null;
  lastSeenAt: string | null;
  doorLabel: string | null;
  notes: string | null;
  iccid: string | null;
  fourgMac: string | null;
  loraE220Addr: number | null;
  loraChannel: number | null;
  loraDevAddr: string | null;
  loraDevEui: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  deployedAt: string | null;
  batchId: string | null;
  batchNo: string | null;
  producedAt: string | null;
  createdAt: string;
}

export interface DeviceListResp {
  items: Device[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DeviceModel {
  id: string;
  code: string;
  name: string;
  category: string;
  scene: string;
  hasBle: boolean;
  has4g: boolean;
  hasGps: boolean;
  hasLora: boolean;
}

export interface ProductionBatch {
  id: string;
  batchNo: string;
  modelId: string;
  modelCode: string | null;
  modelName: string | null;
  quantity: number;
  producedCount: number;
  scannedCount: number;
  actualDeviceCount: number;
  producedAt: string | null;
  remark: string | null;
  completedAt?: string | null;
  completedByUserId?: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  companyId: string | null;
  actor: { id: string; name: string; phone: string } | null;
  actorIp: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  diff: unknown;
  createdAt: string;
}

export interface AuditLogListResp {
  items: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BatchListResp {
  items: ProductionBatch[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProductionScan {
  id: string;
  deviceId: string | null;
  qrScanned: string | null;
  bleMacRead: string | null;
  imeiRead: string | null;
  firmwareVersionRead: string | null;
  qcResult: string;
  qcRemark: string | null;
  scannedAt: string;
  durationMs: number | null;
}

export interface DeviceTransfer {
  id: string;
  fromStatus: string;
  toStatus: string;
  fromOwnerType: string | null;
  fromOwnerId: string | null;
  toOwnerType: string | null;
  toOwnerId: string | null;
  operatorUserId: string | null;
  reason: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface CompanySummary {
  id: string;
  name: string;
  shortCode: string | null;
  industry: string;
  contactName: string | null;
  contactPhone: string | null;
  status: string;
  plan: string;
  maxDevices: number | null;
  deviceCount: number;
  departmentCount: number;
  userCount: number;
  createdAt: string;
}

export interface CompanyDetail extends Omit<CompanySummary, 'departmentCount' | 'createdAt'> {
  departments: Array<{
    id: string;
    name: string;
    code: string | null;
    parentId: string | null;
    teams: Array<{
      id: string;
      name: string;
      leaderUserId: string | null;
      memberCount: number;
    }>;
  }>;
}

export interface CompanyListResp {
  items: CompanySummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserSummary {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  employeeNo: string | null;
  role: string;
  status: string;
  companyId: string | null;
  companyName: string | null;
  teams: Array<{ id: string; name: string; roleInTeam: string }>;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UserListResp {
  items: UserSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ShipResponse {
  shippedCount: number;
  toCompanyId: string;
  devices: Array<{ id: string; lockId: string; status: string }>;
}

export interface GatewaySummary {
  id: string;
  gwId: string;
  model: string;
  companyId: string | null;
  status: string;
  online: boolean;
  lastSeenAt: string | null;
}

export interface AssignResponse {
  assignedCount: number;
  teamId: string;
  teamName: string;
  devices: Array<{ id: string; lockId: string; status: string }>;
}

export interface IntegrationApp {
  id: string;
  name: string;
  appKey: string;
  scopes: string[];
  status: string;
  ipWhitelist: string[] | null;
  webhookCount: number;
  createdAt: string;
}

export interface IntegrationAppCreated {
  id: string;
  name: string;
  appKey: string;
  appSecret: string;
  scopes: string[];
}

export interface WebhookSubscription {
  id: string;
  url: string;
  eventTypes: string[];
  active: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
}

export interface WebhookSubscriptionCreated extends WebhookSubscription {
  secret: string;
  createdAt: string;
}

export interface Alarm {
  id: string;
  deviceId: string;
  lockId: string | null;
  type: 'low_battery' | 'offline' | 'tampered' | 'command_timeout';
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  message: string;
  payload: unknown;
  triggeredAt: string;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  resolvedAt: string | null;
}

export interface AlarmListResp {
  items: Alarm[];
  total: number;
  openCount: number;
  page: number;
  pageSize: number;
}

export interface Notification {
  id: string;
  kind: 'alarm' | 'ship' | 'deliver' | 'assign' | 'remote_command' | 'system';
  title: string;
  body: string;
  link: string | null;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResp {
  items: Notification[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
}

export interface DashboardSummary {
  deviceCounts: {
    total: number;
    byStatus: Record<string, number>;
  };
  online: {
    active: number;
    online: number;
    rate: number | null;
  };
  alarms: {
    open: number;
    byCritical: number;
    byWarning: number;
    byInfo: number;
  };
  events: {
    recent7d: number;
    histogram: Array<{ day: string; count: number }>;
  };
  recentDevices: Array<{
    id: string;
    lockId: string;
    status: string;
    lastState: string;
    lastBattery: number | null;
    lastSeenAt: string | null;
  }>;
}

export interface DeviceCommand {
  id: string;
  commandType: string;
  status: 'pending' | 'sent' | 'acked' | 'timeout' | 'failed';
  source: string;
  retries: number;
  issuedByUserId: string;
  sentAt: string | null;
  ackedAt: string | null;
  timeoutAt: string | null;
  resultEventId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

// ----- Firmware (OTA) -----

export interface FirmwarePackage {
  id: string;
  ulid: string;
  companyId: string | null;
  modelId: string;
  modelCode: string;
  modelName: string;
  version: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  changelog: string | null;
  status: 'draft' | 'released' | 'archived';
  uploadedByUserId: string | null;
  releasedAt: string | null;
  createdAt: string;
}

export interface FirmwarePackageListResp {
  items: FirmwarePackage[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FirmwareTask {
  id: string;
  packageId: string;
  deviceId: string;
  status: 'queued' | 'pushing' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  errorMessage: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  triggeredByUserId: string | null;
  createdAt: string;
  packageVersion: string;
}

export interface FirmwareTaskListResp {
  items: FirmwareTask[];
  total: number;
  page: number;
  pageSize: number;
}

// ----- v2.6 Permission requests + temporary unlock -----

export interface PermissionRequestItem {
  deviceId: string;
  status: 'pending' | 'approved' | 'rejected';
  assignmentId: string | null;
}

export interface PermissionRequest {
  id: string;
  ulid: string;
  applicantUserId: string;
  companyId: string;
  reason: string;
  validFrom: string | null;
  validUntil: string | null;
  status: 'pending' | 'approved' | 'partial' | 'rejected' | 'cancelled';
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  items: PermissionRequestItem[];
  createdAt: string;
}

export interface PermissionRequestPendingItem extends PermissionRequest {
  applicant: { id: string; name: string; phone: string };
  devices: Array<{
    deviceId: string;
    lockId: string;
    status: 'pending' | 'approved' | 'rejected';
  }>;
}

export interface TemporaryUnlock {
  id: string;
  ulid: string;
  applicantUserId: string;
  companyId: string;
  deviceId: string;
  reason: string;
  durationMinutes: 60 | 120 | 240 | 480;
  emergency: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked' | 'cancelled';
  approvedAt: string | null;
  validUntil: string | null;
  decidedByUserId: string | null;
  decisionNote: string | null;
  assignmentId: string | null;
  remainingSeconds: number | null;
  createdAt: string;
}

export interface TemporaryUnlockPendingItem extends TemporaryUnlock {
  applicant: { id: string; name: string; phone: string };
  device: { id: string; lockId: string; doorLabel: string | null };
}

// ----- v2.6 Repair flow -----

export interface DeviceRepair {
  id: string;
  ulid: string;
  deviceId: string;
  sourceCompanyId: string | null;
  priorStatus: string;
  faultReason: string;
  status:
    | 'intake'
    | 'diagnosing'
    | 'repairing'
    | 'awaiting_parts'
    | 'repaired'
    | 'irreparable'
    | 'returned';
  intakeByUserId: string | null;
  repairedByUserId: string | null;
  notes: string | null;
  partsReplaced: unknown;
  intakeAt: string;
  repairedAt: string | null;
  closedAt: string | null;
}

export interface DeviceRepairListItem extends DeviceRepair {
  device: { id: string; lockId: string; bleMac: string };
  sourceCompanyName: string | null;
}

export interface DeviceRepairListResp {
  items: DeviceRepairListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ----- v2.6 Authorizations (long-lived assignments) -----

export interface Authorization {
  id: string;
  deviceId: string;
  lockId: string;
  doorLabel: string | null;
  scope: 'company' | 'team' | 'user';
  teamId: string | null;
  teamName: string | null;
  userId: string | null;
  userName: string | null;
  userPhone: string | null;
  validFrom: string | null;
  validUntil: string | null;
  revokedAt: string | null;
  createdAt: string;
  state: 'active' | 'expiring' | 'expired' | 'revoked';
}

export interface AuthorizationListResp {
  items: Authorization[];
  total: number;
  page: number;
  pageSize: number;
}

// ----- v2.7 device-tree -----

export interface OrgTeam {
  id: string;
  name: string;
  leaderUserId: string | null;
  leaderName: string | null;
  leaderPhone: string | null;
  deviceCount: number;
  memberCount: number;
}
export interface OrgDepartment {
  id: string;
  name: string;
  code: string | null;
  deviceCount: number;
  teams: OrgTeam[];
}
export interface OrgTree {
  id: string;          // company id
  name: string;
  deviceCount: number;
  unassignedCount: number;
  departments: OrgDepartment[];
}

export type OrgNodeSelection =
  | { type: 'company'; id: string; name: string }
  | { type: 'department'; id: string; name: string; companyId: string }
  | { type: 'team'; id: string; name: string; departmentId: string; companyId: string };
