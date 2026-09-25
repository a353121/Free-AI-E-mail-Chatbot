import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { stdin, stdout } from 'node:process';

if (!stdin.isTTY || !stdout.isTTY) throw new Error('Run this command in an interactive terminal.');
stdout.write('Admin password: ');
stdin.setRawMode(true);
stdin.resume();
const password = await new Promise(resolve => {
  let value = '';
  const onData = chunk => {
    const text = chunk.toString();
    if (text === '\u0003') process.exit(130);
    if (text === '\r' || text === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); stdout.write('\n'); resolve(value); return; }
    if (text === '\u007f') { value = value.slice(0, -1); return; }
    value += text;
  };
  stdin.on('data', onData);
});
if (password.length < 14) throw new Error('Use an admin password of at least 14 characters.');
const iterations = 210_000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
const encode = value => value.toString('base64url');
console.log(`pbkdf2-sha256$${iterations}$${encode(salt)}$${encode(hash)}`);
