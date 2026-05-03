/**
 * SMS dispatch.
 *
 * Two providers:
 *   - aliyunProvider:  real, calls Aliyun dysms via @alicloud/dysmsapi20170525
 *   - stubProvider:    no-op, just logs (dev / tests / unconfigured envs)
 *
 * `getSmsProvider()` returns the Aliyun-backed one when ALIYUN_SMS_*
 * envs are set; otherwise the stub. Switching is automatic — no code
 * change required after configuring .env.
 */

import type { Logger } from 'pino';

export interface SmsRequest {
  /** China mobile, 11 digits. */
  phone: string;
  /** Aliyun TemplateCode (e.g. 'SMS_123456789'). */
  templateCode: string;
  /** Aliyun TemplateParam (key/value map). */
  templateParam?: Record<string, string>;
  /** Override the per-account 签名; falls back to env ALIYUN_SMS_SIGN_NAME. */
  signName?: string;
}

export interface SmsResult {
  success: boolean;
  bizId?: string;
  message?: string;
}

export interface SmsProvider {
  send(req: SmsRequest): Promise<SmsResult>;
}

const stubProvider: SmsProvider = {
  async send(req) {
    return {
      success: true,
      bizId: 'stub-' + Date.now(),
      message: `[STUB] Would send SMS to ${req.phone} (template ${req.templateCode})`,
    };
  },
};

let cachedAliyun: SmsProvider | null = null;

async function buildAliyunProvider(): Promise<SmsProvider | null> {
  const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
  const defaultSignName = process.env.ALIYUN_SMS_SIGN_NAME;
  const endpoint = process.env.ALIYUN_SMS_ENDPOINT ?? 'dysmsapi.aliyuncs.com';
  if (!accessKeyId || !accessKeySecret || !defaultSignName) return null;

  // Lazy import — avoids paying the cost when running without Aliyun
  // configuration.
  const { default: Dysmsapi20170525 } = await import('@alicloud/dysmsapi20170525');
  const { default: OpenApiConfig } = await import('@alicloud/openapi-client');
  const { SendSmsRequest } = await import('@alicloud/dysmsapi20170525');

  const config = new OpenApiConfig.Config({
    accessKeyId,
    accessKeySecret,
    endpoint,
  });
  // The Aliyun SDK's typings are partly any due to its tea-runtime; cast
  // through unknown to avoid noisy `any` exposure to callers.
  const client = new (Dysmsapi20170525 as unknown as new (cfg: unknown) => unknown)(
    config,
  ) as {
    sendSms: (req: unknown) => Promise<{
      body?: { code?: string; message?: string; bizId?: string };
    }>;
  };

  return {
    async send(req) {
      const body = new SendSmsRequest({
        phoneNumbers: req.phone,
        signName: req.signName ?? defaultSignName,
        templateCode: req.templateCode,
        templateParam: req.templateParam ? JSON.stringify(req.templateParam) : undefined,
      });
      const resp = await client.sendSms(body);
      const ok = resp.body?.code === 'OK';
      return {
        success: ok,
        bizId: resp.body?.bizId,
        message: resp.body?.message ?? (ok ? 'OK' : 'unknown'),
      };
    },
  };
}

export function getSmsProvider(): SmsProvider {
  if (cachedAliyun) return cachedAliyun;
  // Fire-and-forget initialization of the Aliyun client. Until it
  // resolves we serve the stub; once it's ready the next call gets the
  // real one. This keeps the worker boot non-blocking even if the
  // import path is slow.
  void buildAliyunProvider().then((p) => {
    if (p) cachedAliyun = p;
  });
  return cachedAliyun ?? stubProvider;
}

export async function dispatchSms(log: Logger, req: SmsRequest): Promise<SmsResult> {
  const provider = getSmsProvider();
  try {
    const result = await provider.send(req);
    if (result.success) {
      log.info(
        { phone: req.phone, template: req.templateCode, bizId: result.bizId },
        'sms sent',
      );
    } else {
      log.warn(
        { phone: req.phone, template: req.templateCode, msg: result.message },
        'sms failed',
      );
    }
    return result;
  } catch (err) {
    log.error({ err, phone: req.phone }, 'sms dispatch error');
    return { success: false, message: (err as Error).message };
  }
}
