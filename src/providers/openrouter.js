import { FALLBACK_REPLY, normalizePlainText, sleep } from '../shared.js';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_TIMEOUT_MS = 20000;
export const OPENROUTER_MAX_ATTEMPTS = 3;

export function summarizeOpenRouterPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { payloadType: typeof payload };
  }

  const choices = payload.choices;
  return {
    choicesIsArray: Array.isArray(choices),
    choicesLength: Array.isArray(choices) ? choices.length : undefined,
    firstChoiceType: Array.isArray(choices) && choices.length > 0 ? typeof choices[0] : undefined,
    messageType: Array.isArray(choices) && choices[0] ? typeof choices[0].message : undefined,
    contentType: Array.isArray(choices) && choices[0]?.message ? typeof choices[0].message.content : undefined
  };
}

export function extractAssistantContent(payload) {
  if (!payload || !Array.isArray(payload.choices)) {
    return null;
  }

  const message = payload.choices[0]?.message;
  if (!message || typeof message !== 'object') {
    return null;
  }

  const content = normalizePlainText(message.content);
  return content || null;
}

export async function generateReply(messages, env, options = {}) {
  const {
    fetchImpl = fetch,
    timeoutMs = OPENROUTER_TIMEOUT_MS,
    maxAttempts = OPENROUTER_MAX_ATTEMPTS,
    url = OPENROUTER_URL
  } = options;

  let lastFailure = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      console.log(`[OPENROUTER] Attempt ${attempt}/${maxAttempts} -> ${url}`);
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Title': 'AI Email Chatbot'
        },
        body: JSON.stringify({
          model: 'openrouter/free',
          messages,
          reasoning: { enabled: true }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        const retryable = response.status === 429 || response.status === 408 || (response.status >= 500 && response.status < 600);
        console.error(`[OPENROUTER] HTTP ${response.status} attempt=${attempt} retryable=${retryable} body=${errorText.slice(0, 200)}`);

        if (retryable && attempt < maxAttempts) {
          await sleep(500 * attempt);
          continue;
        }

        return {
          ok: false,
          content: FALLBACK_REPLY,
          reason: retryable ? 'temporary-upstream-failure' : `http-${response.status}`
        };
      }

      const payload = await response.json();
      const assistantContent = extractAssistantContent(payload);
      if (!assistantContent) {
        console.error('[OPENROUTER] Invalid response payload', summarizeOpenRouterPayload(payload));
        return {
          ok: false,
          content: FALLBACK_REPLY,
          reason: 'invalid-payload'
        };
      }

      console.log('[OPENROUTER] Response received successfully');
      return {
        ok: true,
        content: assistantContent,
        reason: 'ok'
      };
    } catch (error) {
      const retryable = error?.name === 'AbortError' || error instanceof TypeError;
      lastFailure = error;
      console.error(`[OPENROUTER] Request failure attempt=${attempt} retryable=${retryable}:`, error);

      if (retryable && attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }

      return {
        ok: false,
        content: FALLBACK_REPLY,
        reason: error?.name === 'AbortError' ? 'timeout' : 'request-failed'
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  console.error('[OPENROUTER] Exhausted retries:', lastFailure);
  return {
    ok: false,
    content: FALLBACK_REPLY,
    reason: 'retries-exhausted'
  };
}
