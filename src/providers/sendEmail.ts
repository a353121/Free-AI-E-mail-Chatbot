import type { AppEnv } from '../env.ts';
import { normalizePlainText } from '../shared.ts';
import type { ThreadHeaders } from '../types.ts';
import { sendReplyEmail as sendBrevo } from './brevo.ts';

export async function sendEmail(env: AppEnv, to: string, subject: string, body: string, threadHeaders: ThreadHeaders = {}, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (env.DELIVERY_PROVIDER === 'cf-send-email') {
    if (!env.EMAIL) throw new Error('EMAIL binding is not configured');
    const text = normalizePlainText(body);
    await (env.EMAIL as unknown as { send(message: unknown): Promise<void> }).send({ from: env.SENDER_EMAIL, to, subject, text });
    return;
  }
  await sendBrevo(env, to, subject, body, threadHeaders, { fetchImpl });
}
