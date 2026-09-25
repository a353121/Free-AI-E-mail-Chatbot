import type { ThreadHeaders } from '../types.ts';
import { FALLBACK_REPLY, normalizePlainText } from '../shared.ts';

export const BREVO_SMTP_URL = 'https://api.brevo.com/v3/smtp/email';

export interface BrevoEnvLike {
  BREVO_API_KEY?: string;
  SENDER_NAME?: string;
  SENDER_EMAIL?: string;
}

export interface SendReplyOptions {
  fetchImpl?: typeof fetch;
  url?: string;
}

export async function sendReplyEmail(
  env: BrevoEnvLike,
  from: string,
  replySubject: string,
  replyBody: string,
  threadHeaders: ThreadHeaders = {},
  options: SendReplyOptions = {}
): Promise<void> {
  const { fetchImpl = fetch, url = BREVO_SMTP_URL } = options;

  if (!env.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY is not configured');
  }
  if (!env.SENDER_EMAIL) {
    throw new Error('SENDER_EMAIL is not configured');
  }

  console.log('[BREVO] Sending reply via Brevo API...');
  if (Object.keys(threadHeaders).length > 0) {
    console.log('[BREVO] Applying threading headers:', threadHeaders);
  } else {
    console.log('[BREVO] No threading headers applied to outbound email.');
  }

  const brevoResponse = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sender: {
        name: env.SENDER_NAME || 'AI E-mail Chatbot',
        email: env.SENDER_EMAIL
      },
      to: [{ email: from }],
      subject: replySubject,
      textContent: normalizePlainText(replyBody) || FALLBACK_REPLY,
      ...(Object.keys(threadHeaders).length > 0 ? { headers: threadHeaders } : {})
    })
  });

  if (!brevoResponse.ok) {
    const errorText = await brevoResponse.text();
    console.error(`[BREVO] HTTP error ${brevoResponse.status}: ${errorText}`);
    throw new Error(`Brevo returned ${brevoResponse.status}`);
  }

  console.log('[BREVO] Reply sent successfully');
}