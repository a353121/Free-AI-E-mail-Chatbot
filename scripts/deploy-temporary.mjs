import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const baseConfigPath = join(root, 'wrangler.temporary.toml');
const generatedDir = join(root, '.wrangler');
const generatedConfigPath = join(generatedDir, 'temporary.generated.toml');
const temporaryArgs = ['--config', baseConfigPath, '--temporary'];
const d1Name = 'ai-email-bot-temporary';
const kvTitle = 'CHAT_MEMORY';
const temporaryAdminPassword = 'testme';

function runWrangler(args, { capture = true, input } = {}) {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: input === undefined ? (capture ? ['inherit', 'pipe', 'inherit'] : 'inherit') : ['pipe', capture ? 'pipe' : 'inherit', 'inherit'],
    input,
    env: process.env,
  });
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

function parseJsonOutput(output, label) {
  const clean = stripAnsi(output).trim();
  const candidates = [];
  for (let index = 0; index < clean.length; index += 1) {
    if (clean[index] !== '[' && clean[index] !== '{') continue;
    try {
      candidates.push(JSON.parse(clean.slice(index)));
    } catch {
      // Wrangler may print account and progress lines before the JSON value.
    }
  }
  const parsed = candidates.at(-1);
  if (parsed === undefined) {
    throw new Error(`Could not parse ${label} output as JSON:\n${clean}`);
  }
  return parsed;
}

function findD1(databases) {
  return databases.find((database) => database.name === d1Name);
}

function findKv(namespaces) {
  return namespaces.find((namespace) => namespace.title === kvTitle);
}

function extractUuid(output, label) {
  const clean = stripAnsi(output);
  const uuid = clean.match(/(?:[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{32})/i)?.[0];
  if (!uuid) throw new Error(`Could not find the ${label} ID in Wrangler output:\n${clean}`);
  return uuid;
}

function encode(value) {
  return value.toString('base64url');
}

function temporaryPasswordHash(password) {
  const iterations = 210_000;
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return `pbkdf2-sha256$${iterations}$${encode(salt)}$${encode(hash)}`;
}

function listD1() {
  const output = runWrangler(['d1', 'list', '--json', ...temporaryArgs]);
  const parsed = parseJsonOutput(output, 'D1 list');
  if (!Array.isArray(parsed)) throw new Error('Wrangler returned an unexpected D1 list.');
  return parsed;
}

function listKv() {
  const output = runWrangler(['kv', 'namespace', 'list', ...temporaryArgs]);
  const parsed = parseJsonOutput(output, 'KV list');
  if (!Array.isArray(parsed)) throw new Error('Wrangler returned an unexpected KV list.');
  return parsed;
}

function resolveD1() {
  const existing = findD1(listD1());
  if (existing?.uuid) {
    console.log(`Using temporary D1 ${d1Name} (${existing.uuid})`);
    return { name: existing.name, id: existing.uuid };
  }

  console.log(`Creating temporary D1 ${d1Name}`);
  const output = runWrangler(['d1', 'create', d1Name, ...temporaryArgs]);
  return { name: d1Name, id: extractUuid(output, 'D1 database') };
}

function resolveKv() {
  const existing = findKv(listKv());
  if (existing?.id) {
    console.log(`Using temporary KV ${kvTitle} (${existing.id})`);
    return { title: existing.title, id: existing.id };
  }

  console.log(`Creating temporary KV ${kvTitle}`);
  const output = runWrangler(['kv', 'namespace', 'create', kvTitle, ...temporaryArgs]);
  return { title: kvTitle, id: extractUuid(output, 'KV namespace') };
}

function writeGeneratedConfig(d1, kv) {
  const mainPath = join(root, 'src', 'index.ts');
  const base = readFileSync(baseConfigPath, 'utf8')
    .replace(/^main = "src\/index\.ts"$/m, `main = ${JSON.stringify(mainPath)}`)
    .trimEnd();
  const migrationsPath = join(root, 'migrations');
  const generated = `${base}\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = ${JSON.stringify(d1.name)}\ndatabase_id = ${JSON.stringify(d1.id)}\nmigrations_dir = ${JSON.stringify(migrationsPath)}\n\n[[kv_namespaces]]\nbinding = "CHAT_MEMORY"\nid = ${JSON.stringify(kv.id)}\n`;
  mkdirSync(dirname(generatedConfigPath), { recursive: true });
  writeFileSync(generatedConfigPath, generated);
}

function setTemporaryAdminSecrets() {
  const put = (name, value) => runWrangler([
    'secret',
    'put',
    name,
    '--config',
    generatedConfigPath,
    '--temporary',
  ], { capture: false, input: `${value}\n` });
  put('ADMIN_PASSWORD_HASH', temporaryPasswordHash(temporaryAdminPassword));
  put('ADMIN_SESSION_SECRET', encode(randomBytes(32)));
  console.log(`Temporary admin is enabled at /admin with password: ${temporaryAdminPassword}`);
}

function main() {
  const deployArgs = process.argv.slice(2).filter((arg) => arg !== '--temporary');
  const d1 = resolveD1();
  const kv = resolveKv();
  console.log('Skipping R2: temporary Cloudflare accounts do not support R2 bindings');
  writeGeneratedConfig(d1, kv);

  console.log('Applying temporary D1 migrations');
  runWrangler([
    'd1',
    'migrations',
    'apply',
    d1.name,
    '--remote',
    '--config',
    generatedConfigPath,
    '--temporary',
  ], { capture: false });

  console.log('Deploying the temporary Worker');
  runWrangler([
    'deploy',
    '--config',
    generatedConfigPath,
    '--temporary',
    ...deployArgs,
  ], { capture: false });

  if (!deployArgs.some((arg) => arg === '--dry-run' || arg.startsWith('--dry-run='))) {
    console.log('Setting temporary admin bootstrap secrets');
    setTemporaryAdminSecrets();
  } else {
    console.log('Dry run requested; temporary admin secrets were not uploaded');
  }

  console.log(`Generated config: ${generatedConfigPath}`);
}

main();
