const HTML_BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'div', 'dl', 'dt', 'dd',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul'
]);

const NAMED_ENTITIES = {
  amp: '&',
  apos: "'",
  copy: '©',
  gt: '>',
  hellip: '…',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  reg: '®',
  trade: '™'
};

const HEADER_PATTERNS = [/^from:/i, /^sent:/i, /^to:/i, /^cc:/i, /^subject:/i, /^date:/i];
const QUOTE_SEPARATOR_PATTERNS = [
  /^on .+wrote:$/i,
  /^-+\s*original message\s*-+$/i,
  /^-+\s*forwarded message\s*-+$/i,
  /^begin forwarded message:?$/i,
  /^forwarded message:?$/i,
  /^_{5,}$/,
  /^>{1,}/
];
const SIGN_OFF_PATTERNS = [
  /^best(?: regards)?[,]?$/i,
  /^regards[,]?$/i,
  /^thanks[,]?$/i,
  /^thank you[,]?$/i,
  /^cheers[,]?$/i,
  /^sincerely[,]?$/i,
  /^warmly[,]?$/i
];

function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1]?.toLowerCase() === 'x';
      const raw = isHex ? entity.slice(2) : entity.slice(1);
      const codePoint = Number.parseInt(raw, isHex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function htmlToReadableText(html) {
  if (typeof html !== 'string' || !html.trim()) {
    return '';
  }

  let output = '';
  let insideTag = false;
  let tagBuffer = '';
  let skipUntilTag = null;

  for (let index = 0; index < html.length; index += 1) {
    const char = html[index];

    if (!insideTag && char === '<') {
      insideTag = true;
      tagBuffer = '<';
      continue;
    }

    if (insideTag) {
      tagBuffer += char;
      if (char !== '>') {
        continue;
      }

      insideTag = false;
      const tagContent = tagBuffer.slice(1, -1).trim();
      const normalizedTag = tagContent.toLowerCase();
      const isClosing = normalizedTag.startsWith('/');
      const tagName = normalizedTag.replace(/^\//, '').split(/\s+/)[0];

      if (skipUntilTag) {
        if (isClosing && tagName === skipUntilTag) {
          skipUntilTag = null;
        }
        continue;
      }

      if (!isClosing && (tagName === 'script' || tagName === 'style' || tagName === 'head')) {
        skipUntilTag = tagName;
        continue;
      }

      if (HTML_BLOCK_TAGS.has(tagName)) {
        output += tagName === 'br' ? '\n' : '\n\n';
      }
      continue;
    }

    if (!skipUntilTag) {
      output += char;
    }
  }

  return normalizeWhitespace(decodeEntities(output));
}

function normalizeWhitespace(text) {
  if (typeof text !== 'string') {
    return '';
  }

  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\t]+/g, ' ')
    .replace(/[ \f\v]+\n/g, '\n')
    .replace(/\n[ \f\v]+/g, '\n')
    .replace(/[ \f\v]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isHeaderBlockStart(lines, index) {
  if (!HEADER_PATTERNS.some(pattern => pattern.test(lines[index]))) {
    return false;
  }

  let headerMatches = 0;
  for (let cursor = index; cursor < Math.min(lines.length, index + 6); cursor += 1) {
    if (HEADER_PATTERNS.some(pattern => pattern.test(lines[cursor]))) {
      headerMatches += 1;
    }
  }

  return headerMatches >= 2;
}

function findQuotedHistoryStart(lines) {
  let sawContent = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }

    if (!sawContent) {
      sawContent = true;
      continue;
    }

    if (QUOTE_SEPARATOR_PATTERNS.some(pattern => pattern.test(line))) {
      return index;
    }

    if (isHeaderBlockStart(lines.map(entry => entry.trim()), index)) {
      return index;
    }
  }

  return -1;
}

function stripQuotedLines(text) {
  const lines = text.split('\n');
  const result = [];

  for (const line of lines) {
    if (line.trim().startsWith('>')) {
      break;
    }
    result.push(line);
  }

  return normalizeWhitespace(result.join('\n'));
}

function stripSignature(text) {
  const lines = text.split('\n');
  const nonEmptyLines = lines.map(line => line.trim()).filter(Boolean);

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const remainder = lines.slice(index + 1).map(entry => entry.trim()).filter(Boolean);

    if (line === '--' || line === '__') {
      return normalizeWhitespace(lines.slice(0, index).join('\n'));
    }

    if (!line) {
      continue;
    }

    const isSignOff = SIGN_OFF_PATTERNS.some(pattern => pattern.test(line));
    if (!isSignOff) {
      continue;
    }

    const messageLineCount = nonEmptyLines.length;
    if (messageLineCount <= 2) {
      return normalizeWhitespace(text);
    }

    if (remainder.length > 0 && remainder.length <= 4) {
      return normalizeWhitespace(lines.slice(0, index).join('\n'));
    }
  }

  return normalizeWhitespace(text);
}

export function normalizeEmailBody({ text, html } = {}) {
  const preferredText = typeof text === 'string' && text.trim() ? normalizeWhitespace(text) : '';
  const fallbackText = !preferredText && typeof html === 'string' ? htmlToReadableText(html) : '';
  const candidate = preferredText || fallbackText;

  if (!candidate) {
    return '';
  }

  const lines = candidate.split('\n');
  const quotedHistoryStart = findQuotedHistoryStart(lines);
  const withoutHistory = quotedHistoryStart === -1
    ? stripQuotedLines(candidate)
    : normalizeWhitespace(lines.slice(0, quotedHistoryStart).join('\n'));

  return stripSignature(withoutHistory);
}

export { decodeEntities, htmlToReadableText, stripSignature };
