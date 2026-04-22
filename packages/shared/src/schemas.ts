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
