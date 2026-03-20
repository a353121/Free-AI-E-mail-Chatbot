import { FALLBACK_REPLY, normalizePlainText } from '../shared.js';

export const BREVO_SMTP_URL = 'https://api.brevo.com/v3/smtp/email';

export async function sendReplyEmail(env, from, replySubject, replyBody, threadHeaders = {}, options = {}) {
  const { fetchImpl = fetch, url = BREVO_SMTP_URL } = options;

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
        name: env.SENDER_NAME,
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
