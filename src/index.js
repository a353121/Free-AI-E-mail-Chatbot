// src/index.js

import PostalMime from 'postal-mime';

const MAX_TURNS = 15;
const MAX_MESSAGES = MAX_TURNS * 2;
const SYSTEM_INSTRUCTIONS_KEY = 'SYSTEM_INSTRUCTIONS';

// Utility function to clean quoted text from email body
function cleanEmailBody(bodyText) {
  if (!bodyText) return '';

  // Step 1: Remove everything after the first occurrence of '\n--\n' (common quote delimiter)
  let cleaned = bodyText;
  const delimiter = '\n--\n';
  const delimiterIndex = cleaned.indexOf(delimiter);
  if (delimiterIndex !== -1) {
    cleaned = cleaned.substring(0, delimiterIndex).trim();
  }

  // Step 2: Remove lines starting with '>' (quoted replies)
  const lines = cleaned.split('\n');
  const filteredLines = lines.filter(line => !line.trim().startsWith('>'));
  cleaned = filteredLines.join('\n').trim();

  return cleaned;
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  const normalized = history
    .filter(item => item && typeof item === 'object')
    .filter(item => (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .map(item => ({ role: item.role, content: item.content }));

  let trimmed = normalized.slice(-MAX_MESSAGES);

  // Keep complete Q&A turn pairs only
  if (trimmed.length % 2 !== 0) {
    trimmed = trimmed.slice(1);
  }

  return trimmed;
}

async function loadHistoryForEmail(kv, email) {
  const stored = await kv.get(email);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    return normalizeHistory(parsed);
  } catch (err) {
    console.error(`[KV] Invalid JSON for ${email}, resetting history:`, err);
    return [];
  }
}

async function loadSystemInstructions(kv) {
  const systemInstructions = await kv.get(SYSTEM_INSTRUCTIONS_KEY);
  if (!systemInstructions || !systemInstructions.trim()) {
    return null;
  }
  return systemInstructions.trim();
}

async function saveHistoryForEmail(kv, email, history) {
  const normalized = normalizeHistory(history);
  await kv.put(email, JSON.stringify(normalized));
  return normalized;
}

export default {
  async email(message, env, ctx) {
    // Use ctx.waitUntil to keep the worker alive for async operations
    ctx.waitUntil((async () => {
      // Basic email info
      const from = message.from;
      const to = message.to;
      const subject = message.headers.get('subject') || '';
      console.log(`[START] Received email from ${from} to ${to} with subject: "${subject}"`);

      // Check if subject contains "openrouter" (case-insensitive)
      if (!subject.toLowerCase().includes('openrouter')) {
        console.log('[IGNORE] Subject does not contain "openrouter" – skipping.');
        return;
      }
      console.log('[PROCESS] Subject contains "openrouter" – proceeding...');

      // Read raw email content
      let rawArrayBuffer;
      try {
        const rawStream = message.raw;
        rawArrayBuffer = await new Response(rawStream).arrayBuffer();
        console.log('[RAW] Email raw size: ' + rawArrayBuffer.byteLength + ' bytes');
      } catch (err) {
        console.error('[ERROR] Failed to read raw email:', err);
        return;
      }

      // Parse email with postal-mime
      let parsed;
      try {
        const parser = new PostalMime();
        parsed = await parser.parse(new Uint8Array(rawArrayBuffer));
        console.log('[PARSED] Email parsed successfully. Subject:', parsed.subject);
      } catch (err) {
        console.error('[ERROR] Failed to parse email with postal-mime:', err);
        return;
      }

      // Extract and clean text body (prefer plain text, fallback to stripped HTML)
      let bodyText = parsed.text;
      if (!bodyText && parsed.html) {
        // Very basic HTML tag stripping – enough for simple emails
        bodyText = parsed.html.replace(/<[^>]*>?/gm, '');
        console.log('[BODY] Extracted text from HTML (tags stripped)');
      }
      if (!bodyText) {
        console.log('[BODY] No text body found – cannot process.');
        return;
      }

      // Clean the body text to remove quoted/replied content
      const cleanBody = cleanEmailBody(bodyText);
      if (!cleanBody) {
        console.log('[BODY] No clean content found after removing quotes – cannot process.');
        return;
      }
      console.log('[BODY] Cleaned text (first 200 chars):', cleanBody.substring(0, 200) + '...');

      // KV: Fetch conversation history (last 15 Q&A turns = 30 objects max)
      let history = [];
      try {
        history = await loadHistoryForEmail(env.CHAT_MEMORY, from);

        if (!(await env.CHAT_MEMORY.get(from))) {
          await env.CHAT_MEMORY.put(from, JSON.stringify(history));
          console.log(`[KV] Created new history for ${from}`);
        }

        console.log(`[KV] Loaded ${history.length} message objects from history for ${from}`);
      } catch (err) {
        console.error('[KV] Error loading history:', err);
        history = [];
      }

      // KV: Fetch optional global system instructions
      let systemInstructions = null;
      try {
        systemInstructions = await loadSystemInstructions(env.CHAT_MEMORY);
        if (systemInstructions) {
          console.log('[KV] Loaded SYSTEM_INSTRUCTIONS');
        } else {
          console.log('[KV] SYSTEM_INSTRUCTIONS not found or empty');
        }
      } catch (err) {
        console.error('[KV] Error loading SYSTEM_INSTRUCTIONS:', err);
      }

      // Build messages array for OpenRouter (system instructions + history + new user message)
      const messages = [
        ...(systemInstructions ? [{ role: 'system', content: systemInstructions }] : []),
        ...history,
        {
          role: 'user',
          content: cleanBody  // Use cleaned body
        }
      ];

      // Call OpenRouter API (reasoning enabled)
      let openrouterResponse;
      try {
        console.log('[OPENROUTER] Sending request to https://openrouter.ai/api/v1/chat/completions');
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            // Optional: identify your app
            'X-Title': 'AI Email Chatbot'
          },
          body: JSON.stringify({
            model: 'openrouter/free',          // auto‑selects a free model
            messages: messages,
            reasoning: { enabled: true }       // enable reasoning
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[OPENROUTER] HTTP error ${response.status}: ${errorText}`);
          throw new Error(`OpenRouter returned ${response.status}`);
        }

        openrouterResponse = await response.json();
        console.log('[OPENROUTER] Response received successfully');
      } catch (err) {
        console.error('[OPENROUTER] Fetch or JSON error:', err);
        return;
      }

      // Extract assistant message (no reasoning details)
      const assistantMessage = openrouterResponse.choices[0].message;
      const assistantContent = assistantMessage.content;

      console.log('[OPENROUTER] Assistant content (first 200 chars):', assistantContent.substring(0, 200) + '...');

      // KV: Save new Q&A turn and keep only last 15 turns (30 objects)
      try {
        const updatedHistory = [
          ...history,
          { role: 'user', content: cleanBody },
          { role: 'assistant', content: assistantContent }
        ];

        const savedHistory = await saveHistoryForEmail(env.CHAT_MEMORY, from, updatedHistory);
        console.log(`[KV] History saved successfully with ${savedHistory.length} message objects`);
      } catch (err) {
        console.error('[KV] Error saving history:', err);
        // Continue to send reply even if KV save fails
      }

      // Build reply email content (plain assistant message)
      const replyBody = assistantContent;

      // Determine reply subject: avoid duplicate "Re:" prefix
      const originalSubject = parsed.subject || subject; // prefer parsed subject
      let replySubject;
      if (originalSubject && originalSubject.trim().toLowerCase().startsWith('re:')) {
        // Already starts with Re: (case-insensitive) – use as is
        replySubject = originalSubject;
      } else {
        // Prepend "Re: "
        replySubject = originalSubject ? `Re: ${originalSubject}` : 'Re: AI response';
      }

      // Send reply via Brevo
      try {
        console.log('[BREVO] Sending reply via Brevo API...');
        const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': env.BREVO_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sender: {
              name: env.SENDER_NAME,
              email: env.SENDER_EMAIL,
            },
            to: [
              {
                email: from,   // original sender
              }
            ],
            subject: replySubject,
            textContent: replyBody,
            // Optional: add HTML content if you prefer a styled email
          })
        });

        if (!brevoResponse.ok) {
          const errorText = await brevoResponse.text();
          console.error(`[BREVO] HTTP error ${brevoResponse.status}: ${errorText}`);
          throw new Error(`Brevo returned ${brevoResponse.status}`);
        }

        console.log('[BREVO] Reply sent successfully');
      } catch (err) {
        console.error('[BREVO] Error sending email:', err);
        return;
      }

      console.log('[DONE] Email processed and reply sent.');
    })()); // end of ctx.waitUntil
  }
};
