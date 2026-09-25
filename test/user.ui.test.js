import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { accountPage } from '../src/user/ui.ts';

test('user portal emits parseable browser JavaScript and provider controls', async () => {
  const html = await accountPage().text();
  const start = html.indexOf('<script');
  const bodyStart = html.indexOf('>', start) + 1;
  const end = html.lastIndexOf('</script>');
  assert.ok(start >= 0 && bodyStart > start && end > bodyStart);
  assert.doesNotThrow(() => new vm.Script(html.slice(bodyStart, end)));
  assert.match(html, /id="provider-forms"/);
  assert.doesNotMatch(html, /id="user-tools"/);
  assert.doesNotMatch(html, /MCP/);
  assert.match(html, /id="disconnect-github"/);
  assert.match(html, /id="disconnect-google"/);
  assert.match(html, /id="audit-list"/);
});
