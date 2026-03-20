export function buildReplySubject(originalSubject) {
  const normalized = typeof originalSubject === 'string' ? originalSubject.trim() : '';

  if (!normalized) {
    return 'Re: AI response';
  }

  return /^re:/i.test(normalized) ? normalized : `Re: ${normalized}`;
}
