export function buildReplySubject(originalSubject: string): string {
  const normalized = typeof originalSubject === 'string' ? originalSubject.trim() : '';

  if (!normalized) {
    return 'Re: AI response';
  }

  return /^re:/i.test(normalized) ? normalized : `Re: ${normalized}`;
}