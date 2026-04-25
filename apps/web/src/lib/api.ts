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

  const url = new URL(path.startsWith('http') ? path : baseUrl + path);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
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
}

export interface LoginResponse {
  accessToken: string;
  user: { id: string; name: string; role: string; companyId: string | null };
}

export interface Device {
  id: string;
  lockId: string;
  bleMac: string;
  imei: string | null;
  model: { id: string; code: string; name: string } | null;
  firmwareVersion: string | null;
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
