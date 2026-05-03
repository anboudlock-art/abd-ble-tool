export const ApiErrorCode = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',

  DEVICE_FEATURE_UNSUPPORTED: 'DEVICE_FEATURE_UNSUPPORTED',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  DEVICE_NOT_DEPLOYED: 'DEVICE_NOT_DEPLOYED',
  GATEWAY_UNREACHABLE: 'GATEWAY_UNREACHABLE',
  COMMAND_TIMEOUT: 'COMMAND_TIMEOUT',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly httpStatus: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(httpStatus: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.httpStatus = httpStatus;
    this.code = code;
    this.details = details;
  }

  toBody(): ApiErrorBody {
    return { code: this.code, message: this.message, details: this.details };
  }

  static unauthorized(msg = 'Unauthorized') {
    return new ApiError(401, ApiErrorCode.UNAUTHORIZED, msg);
  }

  static forbidden(msg = 'Forbidden') {
    return new ApiError(403, ApiErrorCode.FORBIDDEN, msg);
  }

  static notFound(msg = 'Not found') {
    return new ApiError(404, ApiErrorCode.NOT_FOUND, msg);
  }

  static conflict(msg: string) {
    return new ApiError(409, ApiErrorCode.CONFLICT, msg);
  }

  static badRequest(msg = 'Bad request', details?: unknown) {
    return new ApiError(400, ApiErrorCode.VALIDATION_ERROR, msg, details);
  }

  static unsupportedOnDevice(msg = 'Feature not supported on this device') {
    return new ApiError(405, ApiErrorCode.DEVICE_FEATURE_UNSUPPORTED, msg);
  }

  static offline(msg = 'Device is offline') {
    return new ApiError(409, ApiErrorCode.DEVICE_OFFLINE, msg);
  }
}
