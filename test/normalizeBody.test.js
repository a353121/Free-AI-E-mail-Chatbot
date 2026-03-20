import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { decodeEntities, htmlToReadableText, normalizeEmailBody, stripSignature } from '../src/email/normalizeBody.js';
import { extractAssistantContent } from '../src/providers/openrouter.js';

const readFixture = async name => fs.readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const readJsonFixture = async name => JSON.parse(await fs.readFile(new URL(`./fixtures/providers/${name}`, import.meta.url), 'utf8'));

test('keeps only top-most Gmail reply content', async () => {
  const text = await readFixture('gmail.txt');
  assert.equal(normalizeEmailBody({ text }), 'Hey team,\n\nHere is the latest update from the customer.');
});

test('removes Outlook header blocks and signature separately', async () => {
  const text = await readFixture('outlook.txt');
  assert.equal(normalizeEmailBody({ text }), 'Please approve the budget update.');
});

test('stops before Apple Mail forwarded message banners', async () => {
  const text = await readFixture('apple-mail.txt');
  assert.equal(normalizeEmailBody({ text }), "Let's ship this version tomorrow.");
});

test('converts HTML-only emails into readable text with decoded entities', async () => {
  const html = await readFixture('html-only.html');
  assert.equal(normalizeEmailBody({ html }), 'Hello team,\n\nThe report is ready & uploaded.\n\nSee you soon,\nJordan');
});

test('can extract a normalized provider response from fixtures', async () => {
  const payload = await readJsonFixture('openrouter-success.json');
  assert.equal(extractAssistantContent(payload), 'Sure — here is a cleaned response with formatting removed.');
});

test('returns null for malformed provider fixtures', async () => {
  const payload = await readJsonFixture('openrouter-invalid.json');
  assert.equal(extractAssistantContent(payload), null);
});

test('decodes numeric and named entities', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &#x1F600;'), 'Tom & Jerry 😀');
});

test('preserves paragraph breaks when rendering HTML', () => {
  assert.equal(htmlToReadableText('<p>One</p><p>Two<br>Three</p>'), 'One\n\nTwo\nThree');
});

test('does not erase very short messages that look like a sign-off', () => {
  assert.equal(stripSignature('Thanks,\nSam'), 'Thanks,\nSam');
});
