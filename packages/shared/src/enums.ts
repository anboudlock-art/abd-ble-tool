/**
 * Shared enums. Mirror Prisma enums from @abd/db to avoid runtime Prisma
 * dependency in browser builds.
 */

export const DeviceCategory = {
  gps_lock: 'gps_lock',
  eseal: 'eseal',
  fourg_eseal: 'fourg_eseal',
  fourg_padlock: 'fourg_padlock',
} as const;
export type DeviceCategory = (typeof DeviceCategory)[keyof typeof DeviceCategory];

export const DeviceScene = {
  logistics: 'logistics',
  security: 'security',
} as const;
export type DeviceScene = (typeof DeviceScene)[keyof typeof DeviceScene];

export const DeviceStatus = {
  manufactured: 'manufactured',
  in_warehouse: 'in_warehouse',
  shipped: 'shipped',
  delivered: 'delivered',
  assigned: 'assigned',
  active: 'active',
  returned: 'returned',
  retired: 'retired',
} as const;
export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];

export const LockState = {
  opened: 'opened',
  closed: 'closed',
  tampered: 'tampered',
  unknown: 'unknown',
} as const;
export type LockState = (typeof LockState)[keyof typeof LockState];

export const UserRole = {
  vendor_admin: 'vendor_admin',
  company_admin: 'company_admin',
  dept_admin: 'dept_admin',
  team_leader: 'team_leader',
  member: 'member',
  production_operator: 'production_operator',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const LockEventType = {
  opened: 'opened',
  closed: 'closed',
  tampered: 'tampered',
  heartbeat: 'heartbeat',
  low_battery: 'low_battery',
  offline: 'offline',
  online: 'online',
} as const;
export type LockEventType = (typeof LockEventType)[keyof typeof LockEventType];

export const LockEventSource = {
  ble: 'ble',
  lora: 'lora',
  fourg: 'fourg',
  system: 'system',
} as const;
export type LockEventSource = (typeof LockEventSource)[keyof typeof LockEventSource];

export const DeviceCommandType = {
  unlock: 'unlock',
  lock: 'lock',
  query_status: 'query_status',
  config_network: 'config_network',
} as const;
export type DeviceCommandType = (typeof DeviceCommandType)[keyof typeof DeviceCommandType];

export const DeviceCommandStatus = {
  pending: 'pending',
  sent: 'sent',
  acked: 'acked',
  timeout: 'timeout',
  failed: 'failed',
} as const;
export type DeviceCommandStatus =
  (typeof DeviceCommandStatus)[keyof typeof DeviceCommandStatus];
