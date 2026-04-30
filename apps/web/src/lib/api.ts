/**
 * Tiny fetch wrapper for the @abd/api backend.
 * Auto-injects bearer token from localStorage and surfaces JSON errors.
 */

const TOKEN_KEY = 'abd:access_token';

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
  clear() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(TOKEN_KEY);
  },
};

const baseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

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
    if (res.status === 401) tokenStorage.clear();
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
  model: { id: string; code: string; name: string } | null;
  firmwareVersion: string | null;
  hardwareVersion: string | null;
  qcStatus: string;
  status: string;
  ownerType: string;
  ownerCompanyId: string | null;
  ownerCompanyName: string | null;
  currentTeamId: string | null;
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
  createdAt: string;
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
