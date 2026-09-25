export function normalizeMessageIdHeader(value: string): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.replace(/\s+/g, ' ') : '';
}

export function buildReferencesHeader(inboundMessageId: string, inboundReferences: string): string {
  const normalizedInboundMessageId = normalizeMessageIdHeader(inboundMessageId);
  const normalizedInboundReferences = normalizeMessageIdHeader(inboundReferences);

  if (!normalizedInboundReferences) {
    return normalizedInboundMessageId;
  }

  if (!normalizedInboundMessageId) {
    return normalizedInboundReferences;
  }

  const referenceParts = normalizedInboundReferences.split(/\s+/).filter(Boolean);
  if (referenceParts.includes(normalizedInboundMessageId)) {
    return referenceParts.join(' ');
  }

  return [...referenceParts, normalizedInboundMessageId].join(' ');
}