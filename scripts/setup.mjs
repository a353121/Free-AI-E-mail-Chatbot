import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const runWrangler = args => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
const uuid = text => text.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
const parseJson = text => {
  const clean = text.trim();
  try { return JSON.parse(clean); } catch { return []; }
};
const current = readFileSync('wrangler.toml', 'utf8');

let config = current;
if (config.includes('<YOUR_D1_DATABASE_ID>')) {
  console.log('Creating D1 database ai-email-bot…');
  const output = runWrangler(['d1', 'create', 'ai-email-bot']);
  const id = uuid(output);
  if (!id) throw new Error('Could not find the D1 database id in Wrangler output.');
  config = config.replace('<YOUR_D1_DATABASE_ID>', id);
}
if (config.includes('<YOUR_KV_NAMESPACE_ID>')) {
  console.log('Creating KV namespace CHAT_MEMORY…');
  const output = runWrangler(['kv', 'namespace', 'create', 'CHAT_MEMORY']);
  const id = uuid(output);
  if (!id) throw new Error('Could not find the KV namespace id in Wrangler output.');
  config = config.replace('<YOUR_KV_NAMESPACE_ID>', id);
}
const r2Buckets = parseJson(runWrangler(['r2', 'bucket', 'list', '--json']));
if (!Array.isArray(r2Buckets) || !r2Buckets.some(bucket => bucket.name === 'ai-email-bot-files')) {
  console.log('Creating R2 bucket ai-email-bot-files…');
  runWrangler(['r2', 'bucket', 'create', 'ai-email-bot-files']);
}
if (!config.match(/binding\s*=\s*"R2"/)) config += '\n\n[[r2_buckets]]\nbinding = "R2"\nbucket_name = "ai-email-bot-files"\n';
if (config !== current) writeFileSync('wrangler.toml', config);
console.log('Bindings are configured. Next run: npm run db:migrate && npm run deploy');
