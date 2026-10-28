import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { stateDir } from './bot.mjs';
import { OWNER } from './policy.mjs';
import { checkAuthorization, MIN_GAS_LAMPORTS, MAX_NETWORK_FEE_LAMPORTS } from './portfolio-policy.mjs';
import { markPortfolio } from './portfolio-mark.mjs';
import { portfolioReturn } from './portfolio-accounting.mjs';
import { sameWallet } from './portfolio-run.mjs';
import { snapshotWallet } from './portfolio-prepare.mjs';
import registry from './assets.json' with { type: 'json' };

const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
const read = name => JSON.parse(fs.readFileSync(path.join(stateDir, name), 'utf8'));
const terminal = new Set(['finalized-and-reconciled', 'expired-unspent', 'failed-on-chain']);
function persist(name, record) {
  const file = path.join(stateDir, name), temporary = file + '.tmp';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, json(record)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(stateDir, 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
export function restoredStop(prior, authorizationSha256) {
  if (prior?.authorizationSha256 !== authorizationSha256) return null;
  return prior.exitReason ?? null;
}
export function mayTryAnotherExit(journal, authorizationSha256) {
  return journal?.owner === OWNER && journal.authorizationSha256 === authorizationSha256 && Array.isArray(journal.attempts) &&
    journal.attempts.every(a => ['finalized-and-reconciled', 'expired-unspent'].includes(a.state));
}
export function monitorDecision(baseline, mark, authorization, nowMs) {
  if (mark.confidence !== 'quote-only' || mark.feeBudgetUsdcAtomic === null || mark.feeBudgetUsdcAtomic === undefined ||
      !Number.isSafeInteger(nowMs) || !Number.isSafeInteger(Date.parse(mark.observedAt)) ||
      nowMs < Date.parse(mark.observedAt) || nowMs - Date.parse(mark.observedAt) > 30_000)
    throw Error('Fresh complete risk marks and exit-fee estimates are required');
  const result = portfolioReturn({ baselineUsdcAtomic: BigInt(baseline.bidMarkedUsdcAtomic), currentUsdcAtomic: BigInt(mark.bidMinimumMarkedUsdcAtomic) - BigInt(mark.feeBudgetUsdcAtomic), depositsUsdcAtomic: 0n, withdrawalsUsdcAtomic: 0n });
  const reason = result.profitUsdcAtomic * 10_000n <= -result.contributedUsdcAtomic * BigInt(authorization.maxLossBps) ? 'loss-trigger'
    : nowMs >= Date.parse(authorization.authorizedUntilISO) ? 'time-limit'
    : result.profitUsdcAtomic * 10_000n >= result.contributedUsdcAtomic * BigInt(authorization.targetBps) ? 'estimated-target' : 'hold';
  return { reason, ...result, valuation: 'quote-only, after an estimated capped exit-fee allowance; not realized return' };
}
function command(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./portfolio-run.mjs', import.meta.url)), ...args], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Error(`Portfolio ${args[0]} stopped with exit code ${code}`)));
  });
}
export async function monitor() {
  const authorizationBytes = fs.readFileSync(path.join(stateDir, 'portfolio-authorization.json'));
  const authorizationHash = createHash('sha256').update(authorizationBytes).digest('hex');
  const authorization = JSON.parse(authorizationBytes);
  checkAuthorization(authorization, Date.now(), { protectiveExit: true });
  const baselineBytes = fs.readFileSync(path.join(stateDir, 'portfolio-baseline.json'));
  if (authorization.approved !== true || authorization.owner !== OWNER || createHash('sha256').update(baselineBytes).digest('hex') !== authorization.baselineSha256)
    throw Error('Monitor requires the approved immutable wallet baseline');
  const baseline = JSON.parse(baselineBytes);
  let exitReason = null;
  const statusFile = path.join(stateDir, 'portfolio-monitor-status.json');
  if (fs.existsSync(statusFile)) {
    const prior = read('portfolio-monitor-status.json');
    exitReason = restoredStop(prior, authorizationHash);
    if (prior.authorizationSha256 === authorizationHash && prior.state === 'positions-closed') {
      console.log(json({ state: 'previously-closed', completedAt: prior.completedAt })); return;
    }
  }
  if (fs.existsSync(path.join(stateDir, 'portfolio-stop.json'))) exitReason ??= restoredStop(read('portfolio-stop.json'), authorizationHash);
  const latch = reason => {
    exitReason ??= reason;
    if (fs.existsSync(path.join(stateDir, 'portfolio-stop.json'))) {
      const prior = read('portfolio-stop.json');
      if (prior.authorizationSha256 === authorizationHash) { exitReason = prior.exitReason; return; }
    }
    persist('portfolio-stop.json', { authorizationSha256: authorizationHash, exitReason, latchedAt: new Date().toISOString() });
  };
  monitoring: for (;;) {
    try {
      if (createHash('sha256').update(fs.readFileSync(path.join(stateDir, 'portfolio-authorization.json'))).digest('hex') !== authorizationHash)
        throw Error('Authorization changed during monitoring');
      if (Date.now() >= Date.parse(authorization.authorizedUntilISO)) latch('time-limit');
      const journal = read('portfolio-journal.json');
      if (journal.owner !== OWNER || journal.authorizationSha256 !== authorizationHash) throw Error('Monitor journal does not match the approved run');
      if (journal.attempts.some(a => a.state === 'failed-on-chain')) throw Error('On-chain failure requires investigation before further trades');
      if (journal.attempts.some(a => !terminal.has(a.state))) { await command('recover'); await delay(5000); continue; }
      const expected = journal.attempts.findLast(a => a.state === 'finalized-and-reconciled')?.observation.walletAfter ?? baseline.wallet;
      if (exitReason) {
        const wallet = await snapshotWallet([], 'finalized');
        if (!sameWallet(wallet, expected)) throw Error('Wallet changed outside this run; protective exits require investigation');
        persist('portfolio-monitor-status.json', { checkedAt: new Date().toISOString(), pid: process.pid, authorizationSha256: authorizationHash, state: 'closing', exitReason });
        const tokens = registry.assets.filter(a => ['ETH', 'HYPE', 'ZEC'].includes(a.symbol) &&
          Object.values(wallet.tokenAccounts).some(t => t?.mint === a.mint && t.amountAtomic > 0n));
        const actions = tokens.map(a => [a.symbol, 'exit']);
        if (wallet.nativeLamports > MIN_GAS_LAMPORTS + MAX_NETWORK_FEE_LAMPORTS) actions.push(['SOL', 'exit-sol']);
        let lastError;
        for (const [symbol, direction] of actions) {
          try { await command('execute', symbol, direction); continue monitoring; }
          catch (error) {
            if (!mayTryAnotherExit(read('portfolio-journal.json'), authorizationHash)) throw error;
            lastError = error;
            console.error(json({ state: 'exit-preparation-rejected', symbol, message: error.message, tryingOtherAssets: true }));
          }
        }
        if (lastError) throw lastError;
        const record = { state: 'positions-closed', exitReason, authorizationSha256: authorizationHash, wallet, completedAt: new Date().toISOString(), realizedReturn: null,
          limit: 'Finalized receipts establish sale quantities and fees. Residual SOL, gas and account deposits still need a quote value; closure alone does not establish a 5 percent realized return.' };
        try { record.finalMark = await markPortfolio(); } catch (error) { record.valuationError = error.message; }
        persist('portfolio-monitor-status.json', record);
        console.log(json({ state: record.state, exitReason, realizedReturn: null })); return;
      }
      const mark = await markPortfolio();
      if (!sameWallet(mark.wallet, expected)) throw Error('Unreconciled wallet change; refusing to attribute capital flows to profit');
      const decision = monitorDecision(baseline, mark, authorization, Date.now());
      if (decision.reason !== 'hold') latch(decision.reason);
      const record = { checkedAt: new Date().toISOString(), pid: process.pid, authorizationSha256: authorizationHash, state: exitReason ? 'closing' : 'watching', exitReason, decision, mark };
      persist('portfolio-monitor-status.json', record);
      console.log(json({ checkedAt: record.checkedAt, state: record.state, exitReason, estimatedReturnBps: decision.returnBps, bidUsdcAtomic: mark.bidMarkedUsdcAtomic }));
      if (exitReason) continue;
    } catch (error) {
      const record = { checkedAt: new Date().toISOString(), pid: process.pid, authorizationSha256: authorizationHash, state: 'attention-required', exitReason, message: error.message, newEntries: false };
      persist('portfolio-monitor-status.json', record); console.error(json(record));
      // Quote/network failures never justify weaker checks or a fresh signature for an unresolved intent.
    }
    await delay(30_000);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let acquired = false;
  const lock = path.join(stateDir, 'portfolio-monitor.lock');
  try {
    const fd = fs.openSync(lock, 'wx', 0o600); acquired = true;
    try { fs.writeFileSync(fd, String(process.pid)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    await monitor();
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { if (acquired) fs.unlinkSync(lock); }
}
