import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';

const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const wallet = '11111111111111111111111111111111';
const apiKey = 'test-only-not-a-real-api-key';
function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helius-package-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'setup');
}
function run(home, args, extraEnv = {}) {
  const env = { ...process.env, HELIUS_API_KEY: apiKey, JUPITER_API_KEY: '', HELIUS_BOT_HOME: home, ...extraEnv };
  delete env.HELIUS_BOT_OWNER;
  const r = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', timeout: 20_000 });
  assert.ifError(r.error);
  assert.ok(!(r.stdout + r.stderr).includes(apiKey), 'CLI must not print API credentials');
  return r;
}

test('CLI help and version work before setup, and invalid arguments fail closed', t => {
  const home = sandbox(t);
  assert.match(run(home, ['--help']).stdout, /Setup never funds/);
  assert.equal(run(home, ['--version']).stdout.trim(), '0.1.0');
  assert.equal(run(home, ['balances']).status, 1);
  assert.equal(run(home, ['made-up']).status, 1);
  assert.equal(run(home, ['init', '--wallet', wallet, '--generate-wallet']).status, 1);
  assert.equal(run(home, ['init', '--wallet', 'invalid']).status, 1);
  assert.equal(fs.existsSync(home), false);
});

test('the npm-style executable symlink runs the CLI entry point', t => {
  const home = sandbox(t);
  const bin = path.join(path.dirname(home), 'helius-bot');
  fs.symlinkSync(cli, bin);
  const r = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '0.1.0');
});

test('watch-only init creates private config for the requested wallet, never a signer or run', t => {
  const home = sandbox(t);
  const result = run(home, ['init', '--wallet', wallet]);
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(home, 'config.json')));
  assert.equal(config.owner, wallet);
  assert.equal(config.mode, 'watch');
  assert.equal(config.heliusApiKey, apiKey);
  assert.deepEqual(fs.readdirSync(home), ['config.json']);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(home).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(home, 'config.json')).mode & 0o777, 0o600);
  }
  assert.equal(run(home, ['trade', 'ETH', '--live']).status, 1);
  assert.equal(run(home, ['monitor', '--live']).status, 1);
  assert.equal(run(home, ['authorize', '--live', '--minutes', '30', '--max-loss-percent', '10', '--target-percent', '5']).status, 1);
  assert.deepEqual(fs.readdirSync(home), ['config.json']);
});

test('a generated wallet matches its public config and init refuses to overwrite it', async t => {
  const home = sandbox(t);
  const r = run(home, ['init', '--generate-wallet']);
  assert.equal(r.status, 0, r.stderr);
  const configBytes = fs.readFileSync(path.join(home, 'config.json'));
  const keyBytes = fs.readFileSync(path.join(home, 'bot-wallet.json'));
  const config = JSON.parse(configBytes);
  const signer = await Keypair.fromSecretKey(Uint8Array.from(JSON.parse(keyBytes)));
  assert.equal(config.owner, signer.publicKey.toBase58());
  assert.equal(config.mode, 'local');
  assert.equal(run(home, ['init', '--generate-wallet']).status, 1);
  assert.deepEqual(fs.readFileSync(path.join(home, 'config.json')), configBytes);
  assert.deepEqual(fs.readFileSync(path.join(home, 'bot-wallet.json')), keyBytes);
  assert.equal(run(home, ['trade', 'ETH']).status, 1);
  assert.equal(run(home, ['trade', 'ETH', '--live']).status, 1);
  assert.equal(run(home, ['authorize', '--live', '--minutes', '0', '--max-loss-percent', '10', '--target-percent', '5']).status, 1);
  assert.equal(fs.existsSync(path.join(home, 'portfolio-authorization.json')), false);
  assert.equal(fs.existsSync(path.join(home, 'portfolio-journal.json')), false);
  assert.equal(fs.existsSync(path.join(home, 'execution.lock')), false);
});

test('status omits signed bytes and uses the setup owner; unsafe file modes and symlinks are refused', t => {
  const home = sandbox(t);
  assert.equal(run(home, ['init', '--wallet', wallet]).status, 0);
  const journal = { owner: wallet, attempts: [{ signature: 'public-signature', state: 'unresolved', wire: 'PRIVATE-SIGNED-BYTES', report: { symbol: 'ETH', direction: 'entry' } }] };
  fs.writeFileSync(path.join(home, 'portfolio-journal.json'), JSON.stringify(journal), { mode: 0o600 });
  const r = run(home, ['status']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).owner, wallet);
  assert.ok(!r.stdout.includes('PRIVATE-SIGNED-BYTES'));
  assert.equal(run(home, ['baseline', '--refresh']).status, 1);
  if (process.platform !== 'win32') {
    fs.chmodSync(path.join(home, 'config.json'), 0o644);
    assert.equal(run(home, ['status']).status, 1);
    fs.chmodSync(path.join(home, 'config.json'), 0o600);
  }
  const link = home + '-symlink';
  fs.symlinkSync(home, link, 'dir');
  assert.equal(run(link, ['status']).status, 1);
});

test('all shared policy consumers bind to a selected wallet without changing the legacy default', t => {
  const home = sandbox(t);
  const module = new URL('./policy.mjs', import.meta.url).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const {OWNER}=await import(${JSON.stringify(module)}); console.log(OWNER)`],
    { env: { ...process.env, HELIUS_BOT_HOME: home, HELIUS_BOT_OWNER: wallet }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), wallet);
});
