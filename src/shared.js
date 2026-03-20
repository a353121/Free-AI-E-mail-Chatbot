export const FALLBACK_REPLY = 'Sorry, I could not generate a reliable response right now. Please try again later.';

export function normalizePlainText(content) {
  if (typeof content !== 'string') {
    return '';
  }

  return content
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/```[\s\S]*?```/g, block => block.replace(/```/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^[\-*>#]+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
