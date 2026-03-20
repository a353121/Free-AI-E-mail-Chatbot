import PostalMime from 'postal-mime';

import { normalizeEmailBody } from './email/normalizeBody.js';
import { buildReplySubject } from './email/subject.js';
import { matchesResetSubject, matchesSubjectTrigger } from './email/triggers.js';
import { buildReferencesHeader, normalizeMessageIdHeader } from './email/threading.js';
import { clearHistoryForEmail, loadHistoryForEmail, loadSystemInstructions, saveHistoryForEmail } from './history/store.js';
import { sendReplyEmail } from './providers/brevo.js';
import { generateReply } from './providers/openrouter.js';
import { normalizePlainText } from './shared.js';

async function parseInboundEmail(message) {
  const rawArrayBuffer = await new Response(message.raw).arrayBuffer();
  const parser = new PostalMime();
  return parser.parse(new Uint8Array(rawArrayBuffer));
}

function buildThreadHeaders(from, inboundMessageId, inboundInReplyTo, inboundReferences) {
  const referencesHeader = buildReferencesHeader(inboundMessageId, inboundReferences);
  const threadHeaders = {};

  if (inboundMessageId) {
    threadHeaders['In-Reply-To'] = inboundMessageId;
  } else if (inboundInReplyTo) {
    console.warn(
      `[THREADING] Falling back to existing In-Reply-To for ${from} because inbound Message-ID is missing: ${inboundInReplyTo}`
    );
    threadHeaders['In-Reply-To'] = inboundInReplyTo;
  } else {
    console.warn(`[THREADING] No Message-ID or In-Reply-To available for ${from}; outbound message will not include In-Reply-To.`);
  }

  if (referencesHeader) {
    threadHeaders.References = referencesHeader;
  } else {
    console.warn(`[THREADING] No Message-ID or References available for ${from}; outbound message will not include References.`);
  }

  return threadHeaders;
}

async function processEmail(message, env) {
  const from = message.from;
  const to = message.to;
  const subject = message.headers.get('subject') || '';
  const inboundMessageId = normalizeMessageIdHeader(message.headers.get('message-id'));
  const inboundInReplyTo = normalizeMessageIdHeader(message.headers.get('in-reply-to'));
  const inboundReferences = normalizeMessageIdHeader(message.headers.get('references'));

  console.log(`[START] Received email from ${from} to ${to} with subject: "${subject}"`);
  console.log('[THREADING] Inbound headers:', {
    messageId: inboundMessageId || '(missing)',
    inReplyTo: inboundInReplyTo || '(missing)',
    references: inboundReferences || '(missing)'
  });

  if (!inboundMessageId) {
    console.warn(
      `[THREADING] Missing inbound Message-ID for message from ${from} to ${to}. Outbound threading may fail if recipients rely on RFC threading headers.`
    );
  }

  const resetMatch = matchesResetSubject(subject);
  if (resetMatch.matched) {
    console.log(`[RESET] Subject matched reset keyword. raw="${subject}" normalized="${resetMatch.normalizedSubject}"`);

    try {
      await clearHistoryForEmail(env.CHAT_MEMORY, from);
      console.log(`[KV] History cleared for ${from} while keeping KV key intact`);
    } catch (error) {
      console.error('[KV] Error clearing history:', error);
      throw error;
    }

    const replySubject = buildReplySubject(subject);
    const threadHeaders = buildThreadHeaders(from, inboundMessageId, inboundInReplyTo, inboundReferences);
    await sendReplyEmail(
      env,
      from,
      replySubject,
      'Your saved chat memory has been reset for this email address. Reply again anytime to start a new conversation.',
      threadHeaders
    );
    console.log('[DONE] Reset request processed and confirmation sent.');
    return;
  }

  const subjectMatch = matchesSubjectTrigger(subject, env);

  if (!subjectMatch.matched) {
    console.log(
      `[IGNORE] Subject skipped. raw="${subject}" normalized="${subjectMatch.normalizedSubject}" trigger="${subjectMatch.config.trigger}" mode=${subjectMatch.config.mode}`
    );
    return;
  }
  console.log(
    `[PROCESS] Subject matched trigger. raw="${subject}" normalized="${subjectMatch.normalizedSubject}" trigger="${subjectMatch.config.trigger}" mode=${subjectMatch.config.mode}`
  );

  const parsed = await parseInboundEmail(message);
  console.log('[PARSED] Email parsed successfully. Subject:', parsed.subject);

  const cleanBody = normalizePlainText(normalizeEmailBody({ text: parsed.text, html: parsed.html }));
  if (!cleanBody) {
    console.log('[BODY] No clean content found after removing quotes – cannot process.');
    return;
  }
  console.log('[BODY] Cleaned text (first 200 chars):', cleanBody.substring(0, 200) + '...');

  let history = [];
  try {
    history = await loadHistoryForEmail(env.CHAT_MEMORY, from);

    if (!(await env.CHAT_MEMORY.get(from))) {
      await env.CHAT_MEMORY.put(from, JSON.stringify(history));
      console.log(`[KV] Created new history for ${from}`);
    }

    console.log(`[KV] Loaded ${history.length} message objects from history for ${from}`);
  } catch (error) {
    console.error('[KV] Error loading history:', error);
    history = [];
  }

  let systemInstructions = null;
  try {
    systemInstructions = await loadSystemInstructions(env.CHAT_MEMORY);
    console.log(systemInstructions ? '[KV] Loaded SYSTEM_INSTRUCTIONS' : '[KV] SYSTEM_INSTRUCTIONS not found or empty');
  } catch (error) {
    console.error('[KV] Error loading SYSTEM_INSTRUCTIONS:', error);
  }

  const messages = [
    ...(systemInstructions ? [{ role: 'system', content: systemInstructions }] : []),
    ...history,
    { role: 'user', content: cleanBody }
  ];

  const replyResult = await generateReply(messages, env);
  const assistantContent = normalizePlainText(replyResult.content);
  console.log(`[OPENROUTER] Reply status=${replyResult.reason} preview=${assistantContent.substring(0, 200)}...`);

  if (replyResult.ok) {
    try {
      const savedHistory = await saveHistoryForEmail(env.CHAT_MEMORY, from, [
        ...history,
        { role: 'user', content: cleanBody },
        { role: 'assistant', content: assistantContent }
      ]);
      console.log(`[KV] History saved successfully with ${savedHistory.length} message objects`);
    } catch (error) {
      console.error('[KV] Error saving history:', error);
    }
  } else {
    console.log(`[OPENROUTER] Sending fallback response to ${from} due to ${replyResult.reason}`);
  }

  const replySubject = buildReplySubject(parsed.subject || subject);
  const threadHeaders = buildThreadHeaders(from, inboundMessageId, inboundInReplyTo, inboundReferences);
  await sendReplyEmail(env, from, replySubject, assistantContent, threadHeaders);
  console.log('[DONE] Email processed and reply sent.');
}

const WORKER_REDIRECT_URL = 'https://github.com/a353121/free-ai-e-mail-chatbot';

export default {
  async fetch() {
    return Response.redirect(WORKER_REDIRECT_URL, 301);
  },

  async email(message, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        await processEmail(message, env);
      } catch (error) {
        console.error('[ERROR] Email processing failed:', error);
      }
    })());
  }
};
