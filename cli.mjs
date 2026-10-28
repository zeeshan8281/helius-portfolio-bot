#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import manifest from './package.json' with { type: 'json' };

const help = `helius-bot ${manifest.version} (Node.js 24+)

  init [--wallet ADDRESS | --generate-wallet]  Set up a watch-only or new local wallet
  watch [--account ADDRESS] [--seconds N]      Stream account updates without signing
  compare [--account ADDRESS] [--seconds N]    Compare WebSocket with 2s HTTP polling
  stream-trade --live                         One 1 USDC -> SOL swap with both observers
  stream-status                              Observe that swap; never sign a replacement
  doctor                                      Check setup and real Helius connectivity
  balances                                    Read finalized SOL and USDC balances
  mark                                        Quote the portfolio without signing
  prepare ETH|HYPE|ZEC|SOL [--exit]             Simulate a proposed trade without signing
  baseline [--refresh]                        Save a baseline; refresh only before authorization
  authorize --live --minutes N --max-loss-percent N --target-percent N
                                              Approve one run (1-1440 minutes, loss <=10%, target 5-10%)
  trade ETH|HYPE|ZEC --live                     One 0.65 USDC entry; total run budget 1.95 USDC
  exit ETH|HYPE|ZEC|SOL --live                  Close the approved position
  monitor --live                              Watch and close at a threshold or deadline
  recover                                     Observe the original unresolved signature
  stop                                        Latch a stop; run monitor --live to close positions
  status                                      Read local run state without printing signed bytes

All commands accept --home DIRECTORY. Default: ~/.local/share/helius-portfolio-bot
init accepts HELIUS_API_KEY and optional JUPITER_API_KEY, or prompts privately.
Setup never funds a wallet, authorizes a run, or submits a trade.
Loss triggers and exit attempts cannot guarantee fills, a maximum loss, or profits.
`;

function writeNew(file, value) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function privateFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || process.platform !== 'win32' && (stat.mode & 0o077))
    throw Error(`Expected a private regular file: ${path.basename(file)} (permissions 600)`);
}

function readConfig(home) {
  if (!fs.existsSync(path.join(home, 'config.json'))) throw Error('Setup missing. Run helius-bot init first.');
  const stat = fs.lstatSync(home);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== 'win32' && (stat.mode & 0o077))
    throw Error('Setup directory must be private (permissions 700) and must not be a symlink.');
  privateFile(path.join(home, 'config.json'));
  const config = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  if (config.schema !== 'helius-bot-setup-v1' || !['watch', 'local'].includes(config.mode) ||
      typeof config.owner !== 'string' || typeof config.heliusApiKey !== 'string' || !config.heliusApiKey.trim())
    throw Error('Invalid setup. Existing files were preserved; do not reset a wallet with pending transactions.');
  if (config.mode === 'local') privateFile(path.join(home, 'bot-wallet.json'));
  return config;
}

async function initialize(home, values) {
  if (fs.existsSync(home)) throw Error('Setup directory already exists; refusing to overwrite any keys, configuration, or run records. Choose another --home.');
  if (values.wallet && values['generate-wallet']) throw Error('Choose --wallet or --generate-wallet, not both.');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stderr.write(chunk, encoding); done(); } });
  const prompt = process.stdin.isTTY ? createInterface({ input: process.stdin, output, terminal: true }) : null;
  const ask = async (question, secret = false) => {
    if (!prompt) throw Error('Non-interactive init requires HELIUS_API_KEY and either --wallet ADDRESS or --generate-wallet.');
    if (secret) { process.stderr.write(question); muted = true; }
    try { return (await prompt.question(secret ? '' : question)).trim(); }
    finally { if (secret) { muted = false; process.stderr.write('\n'); } }
  };
  try {
    const apiKey = (process.env.HELIUS_API_KEY ?? await ask('Helius API key (hidden): ', true)).trim();
    if (!apiKey) throw Error('A Helius API key is required.');
    const wallet = values.wallet ?? (values['generate-wallet'] ? '' : await ask('Wallet address to inspect (blank creates a new dedicated local wallet): '));
    const { Keypair, PublicKey } = await import('@solana/web3.js');
    const signer = wallet ? null : await Keypair.generate();
    const owner = signer ? signer.publicKey.toBase58() : new PublicKey(wallet).toBase58();
    const config = { schema: 'helius-bot-setup-v1', mode: signer ? 'local' : 'watch', owner, heliusApiKey: apiKey };
    if (process.env.JUPITER_API_KEY?.trim()) config.jupiterApiKey = process.env.JUPITER_API_KEY.trim();
    fs.mkdirSync(path.dirname(home), { recursive: true, mode: 0o700 });
    fs.mkdirSync(home, { mode: 0o700 });
    if (signer) writeNew(path.join(home, 'bot-wallet.json'), Array.from(signer.secretKey));
    writeNew(path.join(home, 'config.json'), config);
    console.log(JSON.stringify({ state: 'initialized', home, owner, mode: config.mode, liveAuthorized: false,
      next: 'Run helius-bot doctor. Back up any new wallet key privately before funding it.' }, null, 2));
  } finally { prompt?.close(); }
}

function basisPoints(value, label) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) throw Error(`${label} requires a percentage with at most two decimal places.`);
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw Error(`Invalid ${label}`);
  return result;
}

async function authorize(home, config, values) {
  if (config.mode !== 'local' || !values.live) throw Error('Live authorization requires a local signing wallet and --live.');
  const minutes = Number(values.minutes);
  if (!/^\d+$/.test(values.minutes ?? '') || !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440)
    throw Error('--minutes must be an integer from 1 to 1440.');
  const maxLossBps = basisPoints(values['max-loss-percent'], '--max-loss-percent');
  const targetBps = basisPoints(values['target-percent'], '--target-percent');
  const lock = path.join(home, 'execution.lock');
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    for (const name of ['portfolio-authorization.json', 'portfolio-journal.json', 'portfolio-stop.json'])
      if (fs.existsSync(path.join(home, name))) throw Error('A run already exists. Its authorization and records cannot be replaced.');
    const baselineBytes = fs.readFileSync(path.join(home, 'portfolio-baseline.json'));
    const baseline = JSON.parse(baselineBytes);
    if (baseline.owner !== config.owner || baseline.schema !== 'helius-portfolio-mark-v1' || baseline.confidence !== 'quote-only' ||
        BigInt(baseline.bidMarkedUsdcAtomic) <= 0n || !Number.isFinite(Date.parse(baseline.observedAt)) ||
        Date.parse(baseline.observedAt) > Date.now() || Date.now() - Date.parse(baseline.observedAt) > 60_000)
      throw Error('Authorization needs this wallet\'s complete positive baseline from the last 60 seconds. Existing baselines are never overwritten.');
    const authorization = { approved: true, owner: config.owner, baselineSha256: createHash('sha256').update(baselineBytes).digest('hex'),
      maxLossBps, targetBps, authorizedUntilISO: new Date(Date.now() + minutes * 60_000).toISOString() };
    const [{ checkAuthorization }, { sameWallet }, { snapshotWallet }] = await Promise.all([
      import('./portfolio-policy.mjs'), import('./portfolio-run.mjs'), import('./portfolio-prepare.mjs'),
    ]);
    checkAuthorization(authorization, Date.now());
    if (!sameWallet(await snapshotWallet([], 'finalized'), baseline.wallet)) throw Error('Wallet changed since the baseline; no authorization written.');
    writeNew(path.join(home, 'portfolio-authorization.json'), authorization);
    console.log(JSON.stringify({ state: 'live-authorized', ...authorization, entryUsdcEach: '0.65', lifetimeEntryUsdc: '1.95',
      next: 'Run each desired trade, then monitor --live on an awake, connected machine. Authorization alone starts no process.' }, null, 2));
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

async function child(file, args) {
  const code = await new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, [fileURLToPath(new URL(file, import.meta.url)), ...args], { stdio: 'inherit' });
    const interrupt = () => processChild.kill('SIGINT');
    const terminate = () => processChild.kill('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    const cleanup = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
    processChild.once('error', error => { cleanup(); reject(error); });
    processChild.once('exit', (code, signal) => { cleanup(); resolve(signal ? 1 : code ?? 1); });
  });
  process.exitCode = code;
}

export async function main(args = process.argv.slice(2)) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('helius-bot requires Node.js 24 or newer.');
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    home: { type: 'string' }, wallet: { type: 'string' }, 'generate-wallet': { type: 'boolean' },
    live: { type: 'boolean' }, 'retry-expired': { type: 'boolean' }, exit: { type: 'boolean' }, refresh: { type: 'boolean' }, minutes: { type: 'string' },
    'max-loss-percent': { type: 'string' }, 'target-percent': { type: 'string' },
    account: { type: 'string' }, seconds: { type: 'string' }, 'poll-ms': { type: 'string' },
    'disconnect-after': { type: 'string' }, output: { type: 'string' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
  } });
  if (values.help || !positionals.length && !values.version) return console.log(help);
  if (values.version) return console.log(manifest.version);
  const [command, symbol] = positionals;
  const allowed = { init: ['wallet', 'generate-wallet'], doctor: [], balances: [], mark: [], prepare: ['exit'], baseline: ['refresh'],
    watch: ['account', 'seconds', 'output'], compare: ['account', 'seconds', 'poll-ms', 'disconnect-after', 'output'], 'stream-trade': ['live', 'retry-expired'], 'stream-status': [],
    authorize: ['live', 'minutes', 'max-loss-percent', 'target-percent'], trade: ['live'], exit: ['live'], monitor: ['live'], recover: [], stop: [], status: [] };
  if (!Object.hasOwn(allowed, command)) throw Error('Unknown command. Run helius-bot --help.');
  if (positionals.length !== (['prepare', 'trade', 'exit'].includes(command) ? 2 : 1)) throw Error('Unexpected or missing command arguments. Run helius-bot --help.');
  for (const option of Object.keys(values)) if (option !== 'home' && !allowed[command].includes(option)) throw Error(`--${option} is not valid for ${command}.`);
  const home = path.resolve(values.home ?? process.env.HELIUS_BOT_HOME ?? path.join(os.homedir(), '.local/share/helius-portfolio-bot'));
  if (command === 'init') return initialize(home, values);
  const config = readConfig(home);
  const { PublicKey } = await import('@solana/web3.js');
  if (new PublicKey(config.owner).toBase58() !== config.owner) throw Error('Invalid configured wallet.');
  process.env.HELIUS_BOT_HOME = home;
  process.env.HELIUS_BOT_OWNER = config.owner;
  if (['trade', 'exit', 'monitor'].includes(command) && (!values.live || config.mode !== 'local'))
    throw Error('This command requires a local signing wallet, an approved run, and --live.');
  if (['prepare', 'trade', 'exit'].includes(command) && !['ETH', 'HYPE', 'ZEC', 'SOL'].includes(symbol)) throw Error('Use the exact symbol ETH, HYPE, ZEC, or SOL.');
  if (command === 'trade' && symbol === 'SOL') throw Error('The fixed allocation retains existing SOL; trade opens only ETH, HYPE, or ZEC.');
  if (command === 'prepare' && symbol === 'SOL' && !values.exit) throw Error('SOL preparation requires --exit.');
  if (command === 'watch' || command === 'compare') {
    const integer = (value, fallback, min, max, label) => {
      const n = Number(value ?? fallback);
      if (!/^\d+$/.test(String(value ?? fallback)) || !Number.isSafeInteger(n) || n < min || n > max) throw Error(`Invalid ${label}: use ${min}..${max}.`);
      return n;
    };
    const seconds = integer(values.seconds, 60, 1, 600, 'seconds');
    const pollMs = integer(values['poll-ms'], 2000, 250, 30000, 'poll-ms');
    const disconnectAfter = integer(values['disconnect-after'], 0, 0, seconds-1, 'disconnect-after');
    const { CLOCK, observeAccount } = await import('./helius-stream.mjs');
    const account = new PublicKey(values.account ?? (command === 'compare' ? CLOCK : config.owner)).toBase58();
    let outputFd;
    if (values.output) outputFd = fs.openSync(path.resolve(values.output), 'wx', 0o600);
    const controller = new AbortController(); const stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const report = await observeAccount({ apiKey: config.heliusApiKey, account, seconds, pollMs, disconnectAfter, compare: command === 'compare', signal: controller.signal });
      if (outputFd !== undefined) { fs.writeFileSync(outputFd, JSON.stringify(report, null, 2)+'\n'); fs.fsyncSync(outputFd); }
    } finally { if (outputFd !== undefined) fs.closeSync(outputFd); process.off('SIGINT', stop); process.off('SIGTERM', stop); }
    return;
  }
  if (command === 'stream-status') {
    const { streamStatus } = await import('./stream-trade.mjs');
    return console.log(JSON.stringify(await streamStatus(), null, 2));
  }
  if (command === 'stream-trade') {
    if (!values.live || config.mode !== 'local') throw Error('stream-trade requires a local signing wallet and explicit --live.');
    const { streamTrade } = await import('./stream-trade.mjs');
    return streamTrade({ apiKey: config.heliusApiKey, live: values.live, retryExpired: values['retry-expired'] });
  }
  if (command === 'authorize') return authorize(home, config, values);
  if (command === 'doctor' || command === 'balances') {
    const { rpc, balances } = await import('./bot.mjs');
    const wallet = await balances('finalized');
    console.log(JSON.stringify(command === 'balances' ? wallet : { state: 'ok', network: 'solana-mainnet', mode: config.mode, home,
      heliusVersion: await rpc('getVersion', []), wallet, liveTradingStarted: false }, null, 2));
    return;
  }
  if (command === 'status') {
    const read = name => fs.existsSync(path.join(home, name)) ? JSON.parse(fs.readFileSync(path.join(home, name), 'utf8')) : null;
    const authorization = read('portfolio-authorization.json');
    const journal = read('portfolio-journal.json');
    console.log(JSON.stringify({ owner: config.owner, mode: config.mode, home, authorization, stop: read('portfolio-stop.json'),
      monitor: (() => { const m = read('portfolio-monitor-status.json'); return m && { state: m.state, checkedAt: m.checkedAt, completedAt: m.completedAt, exitReason: m.exitReason }; })(),
      attempts: (journal?.attempts ?? []).map(a => ({ signature: a.signature, state: a.state, symbol: a.report.symbol, direction: a.report.direction })) }, null, 2));
    return;
  }
  if (command === 'stop') {
    const bytes = fs.readFileSync(path.join(home, 'portfolio-authorization.json'));
    const record = { authorizationSha256: createHash('sha256').update(bytes).digest('hex'), exitReason: 'manual-stop', latchedAt: new Date().toISOString() };
    writeNew(path.join(home, 'portfolio-stop.json'), record);
    return console.log(JSON.stringify({ ...record, next: 'New entries blocked. Run monitor --live to close approved positions; this command submits nothing.' }, null, 2));
  }
  if (command === 'baseline') {
    const lock = path.join(home, 'execution.lock');
    const fd = fs.openSync(lock, 'wx', 0o600);
    try {
      for (const name of ['portfolio-authorization.json', 'portfolio-journal.json', 'portfolio-stop.json'])
        if (fs.existsSync(path.join(home, name))) throw Error('A run already exists; its baseline cannot be changed.');
      const file = path.join(home, 'portfolio-baseline.json');
      if (fs.existsSync(file) && !values.refresh) throw Error('Baseline exists. Use baseline --refresh only before authorization.');
      const { balances } = await import('./bot.mjs');
      if ((await balances('finalized')).solLamports === 0) throw Error('Wallet is unfunded: SOL is required for gas. No baseline written.');
      const { markPortfolio, saveBaseline } = await import('./portfolio-mark.mjs');
      const report = await markPortfolio();
      if (BigInt(report.bidMarkedUsdcAtomic) <= 0n) throw Error('A zero-value wallet cannot establish a trading baseline. No baseline written.');
      if (fs.existsSync(file)) fs.renameSync(file, path.join(home, `portfolio-baseline-${Date.now()}.json`));
      report.savedBaseline = await saveBaseline(report, file);
      return console.log(JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  if (command === 'mark') return child('./portfolio-mark.mjs', []);
  if (command === 'prepare') return child('./portfolio-prepare.mjs', [symbol, values.exit ? symbol === 'SOL' ? 'exit-sol' : 'exit' : 'entry']);
  if (command === 'trade' || command === 'exit') return child('./portfolio-run.mjs', ['execute', symbol, command === 'trade' ? 'entry' : symbol === 'SOL' ? 'exit-sol' : 'exit']);
  if (command === 'monitor') return child('./portfolio-monitor.mjs', []);
  if (command === 'recover') return child('./portfolio-run.mjs', ['recover']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { await main(); }
  catch (error) {
    let message = error.message;
    for (const key of [process.env.HELIUS_API_KEY, process.env.JUPITER_API_KEY]) if (key) message = message.replaceAll(key, '[redacted]');
    console.error(message);
    process.exitCode = 1;
  }
}
