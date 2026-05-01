/**
 * SMS dispatch with a swappable provider. In production this should call
 * Aliyun SMS via @alicloud/dysmsapi20170525. For now we ship a stub
 * provider that just logs the request — wire the real one in by setting:
 *
 *   ALIYUN_SMS_ACCESS_KEY_ID
 *   ALIYUN_SMS_ACCESS_KEY_SECRET
 *   ALIYUN_SMS_SIGN_NAME
 *
 * and replacing `stubProvider` with the Aliyun-backed implementation.
 */

import type { Logger } from 'pino';

export interface SmsRequest {
  /** China mobile, 11 digits. */
  phone: string;
  /** Aliyun TemplateCode (e.g. 'SMS_123456789'). */
  templateCode: string;
  /** Aliyun TemplateParam (JSON string of {var: value}). */
  templateParam?: Record<string, string>;
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
      message: `[STUB] Would have sent SMS to ${req.phone} with template ${req.templateCode}`,
    };
  },
};

export function getSmsProvider(): SmsProvider {
  // Hook: if Aliyun creds are present, return a real provider.
  // Lazy-loading keeps `@alicloud/dysmsapi20170525` out of the dep tree
  // until ops actually wires it.
  // For now we always return the stub.
  return stubProvider;
}

export async function dispatchSms(log: Logger, req: SmsRequest): Promise<SmsResult> {
  const provider = getSmsProvider();
  const result = await provider.send(req);
  if (result.success) {
    log.info({ phone: req.phone, bizId: result.bizId }, 'sms sent');
  } else {
    log.warn({ phone: req.phone, msg: result.message }, 'sms failed');
  }
  return result;
}
