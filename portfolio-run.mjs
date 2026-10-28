import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { rpc, owner, stateDir } from './bot.mjs';
import { OWNER } from './policy.mjs';
import { checkAuthorization, checkPortfolioBuild } from './portfolio-policy.mjs';
import { preparePortfolioTrade, snapshotWallet, validateEffects } from './portfolio-prepare.mjs';
import { markPortfolio } from './portfolio-mark.mjs';
import { portfolioReturn } from './portfolio-accounting.mjs';

const journalFile = path.join(stateDir, 'portfolio-journal.json');
const authorizationFile = path.join(stateDir, 'portfolio-authorization.json');
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
const digest = text => createHash('sha256').update(text).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const terminal = new Set(['finalized-and-reconciled', 'expired-unspent', 'failed-on-chain']);

export function entryReservations(attempts) {
  const spent = {};
  for (const attempt of attempts) {
    if (attempt.report.direction !== 'entry' || attempt.state === 'expired-unspent') continue;
    const mint = attempt.report.outputMint;
    spent[mint] = (spent[mint] ?? 0n) + BigInt(attempt.report.inputAtomic);
  }
  return spent;
}
function persist(journal) {
  const temporary = journalFile + '.tmp';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, json(journal)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, journalFile);
  const directory = fs.openSync(stateDir, 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
function loadAuthorization(direction) {
  if (!fs.existsSync(authorizationFile)) throw Error('No risk/time authorization recorded; no key loaded or transaction signed');
  const raw = fs.readFileSync(authorizationFile, 'utf8'), authorization = JSON.parse(raw);
  checkAuthorization(authorization, Date.now(), { protectiveExit: direction !== 'entry' });
  if (authorization.owner !== OWNER || typeof authorization.baselineSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(authorization.baselineSha256)) throw Error('Authorization is not bound to this wallet and baseline');
  const baselineFile = path.join(stateDir, 'portfolio-baseline.json');
  if (digest(fs.readFileSync(baselineFile)) !== authorization.baselineSha256) throw Error('Approved baseline changed');
  return { authorization, authorizationSha256: digest(raw) };
}
export function checkJournal(journal, authorizationSha256) {
  if (journal.owner !== OWNER || journal.authorizationSha256 !== authorizationSha256 || !Array.isArray(journal.attempts))
    throw Error('Journal does not match the approved wallet and run');
  if (journal.attempts.some(a => !terminal.has(a.state))) throw Error('An existing transaction is unresolved; recover its original signature first');
  if (journal.attempts.some(a => a.state === 'failed-on-chain')) throw Error('A trade failed on chain; investigate its fee and account state before continuing');
}
export function sameWallet(snapshot, before) {
  if (snapshot.nativeLamports !== BigInt(before.nativeLamports)) return false;
  const relevant = new Set([...snapshot.addresses, ...before.addresses]);
  for (const address of relevant) {
    const now = snapshot.tokenAccounts[address], previous = before.tokenAccounts[address];
    if ((now?.amountAtomic ?? 0n) !== BigInt(previous?.amountAtomic ?? 0) || Boolean(now) !== Boolean(previous)) return false;
    if (now && (now.owner !== previous.owner || now.mint !== previous.mint || now.delegate !== previous.delegate ||
        now.delegatedAmount !== BigInt(previous.delegatedAmount) || now.closeAuthority !== previous.closeAuthority || now.state !== previous.state)) return false;
    if (address !== OWNER && BigInt(snapshot.accounts[address]?.lamports ?? 0) !== BigInt(before.accounts[address]?.lamports ?? 0)) return false;
  }
  return true;
}
export function checkEntryRisk(baseline, mark, authorization) {
  if (baseline.owner !== OWNER || mark.owner !== OWNER || baseline.confidence !== 'quote-only' || mark.confidence !== 'quote-only' ||
      !Number.isSafeInteger(Date.parse(mark.observedAt)) || Date.now() - Date.parse(mark.observedAt) > 30_000 || Date.parse(mark.observedAt) > Date.now())
    throw Error('Fresh complete portfolio risk marks are required');
  const value = BigInt(mark.bidMinimumMarkedUsdcAtomic) - BigInt(mark.feeBudgetUsdcAtomic);
  if (value < 0n) throw Error('Estimated exit fees exceed marked portfolio');
  const result = portfolioReturn({ baselineUsdcAtomic: BigInt(baseline.bidMarkedUsdcAtomic), currentUsdcAtomic: value, depositsUsdcAtomic: 0n, withdrawalsUsdcAtomic: 0n });
  if (result.profitUsdcAtomic * 10_000n <= -result.contributedUsdcAtomic * BigInt(authorization.maxLossBps))
    throw Error('Estimated portfolio loss reached the approved trigger; no new entries');
  if (result.profitUsdcAtomic * 10_000n >= result.contributedUsdcAtomic * BigInt(authorization.targetBps))
    throw Error('Estimated target reached; no new entries, verify liquidation instead');
  return { kind: 'estimated-risk-gate-not-realized-return', ...result };
}
async function reconcile(attempt) {
  const chain = await rpc('getTransaction', [attempt.signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
  if (!chain?.meta || chain.meta.err !== null) throw Error('Successful finalized transaction metadata is unavailable');
  const report = attempt.report, before = report.before;
  const keys = [...chain.transaction.message.accountKeys, ...(chain.meta.loadedAddresses?.writable ?? []), ...(chain.meta.loadedAddresses?.readonly ?? [])];
  if (keys[0] !== OWNER || chain.transaction.message.header.numRequiredSignatures !== 1) throw Error('Unexpected finalized fee payer or signers');
  const actual = await snapshotWallet(before.addresses, 'finalized');
  if (actual.slot < chain.slot || actual.addresses.some(a => !before.addresses.includes(a))) throw Error('Unexplained wallet accounts after settlement');
  for (const address of before.addresses) {
    const index = keys.indexOf(address), pre = before.accounts[address], post = actual.accounts[address];
    if (index < 0) {
      if (JSON.stringify(post) !== JSON.stringify(pre)) throw Error('An unreferenced account changed');
      continue;
    }
    if (BigInt(chain.meta.preBalances[index]) !== BigInt(pre?.lamports ?? 0) ||
        BigInt(chain.meta.postBalances[index]) !== BigInt(post?.lamports ?? 0)) throw Error('Actual account lamports do not reconcile with the prepared wallet');
    if (address === OWNER) continue;
    for (const [entries, token] of [[chain.meta.preTokenBalances, before.tokenAccounts[address]], [chain.meta.postTokenBalances, actual.tokenAccounts[address]]]) {
      const observed = entries.find(e => e.accountIndex === index);
      if (token && (!observed || observed.owner !== OWNER || observed.mint !== token.mint || BigInt(observed.uiTokenAmount.amount) !== BigInt(token.amountAtomic)))
        throw Error('Actual token balances, mint, or authority do not reconcile');
      if (!token && observed && BigInt(observed.uiTokenAmount.amount) !== 0n) throw Error('Unexpected token holding in finalized metadata');
    }
  }
  const revived = { ...before, nativeLamports: BigInt(before.nativeLamports), tokenAccounts: Object.fromEntries(Object.entries(before.tokenAccounts).map(([a, t]) => [a, t && { ...t, amountAtomic: BigInt(t.amountAtomic), delegatedAmount: BigInt(t.delegatedAmount), lamports: BigInt(t.lamports) }])) };
  const effects = validateEffects({ before: revived, after: actual.accounts, inputAddress: report.inputAddress, outputAddress: report.outputAddress,
    outputMint: report.outputMint, minimum: BigInt(report.minimumOutputAtomic), input: BigInt(report.inputAtomic), direction: report.direction,
    fee: BigInt(chain.meta.fee), expectedNewRent: BigInt(report.effects.newOutputAtaRentLamports), expectedRefund: BigInt(report.effects.verifiedInputAtaRefundLamports) });
  return { state: 'finalized-and-reconciled', signature: attempt.signature, slot: chain.slot, blockTime: chain.blockTime, walletAfter: actual,
    symbol: report.symbol, direction: report.direction, effects, explorer: `https://solscan.io/tx/${attempt.signature}` };
}
async function observeAttempt(attempt) {
  const statuses = await rpc('getSignatureStatuses', [[attempt.signature], { searchTransactionHistory: true }]);
  const status = statuses.value[0];
  if (status?.confirmationStatus === 'finalized') {
    if (status.err !== null) return { state: 'failed-on-chain', error: status.err, signature: attempt.signature };
    return await reconcile(attempt);
  }
  if (status) return { state: 'unresolved', confirmationStatus: status.confirmationStatus, signature: attempt.signature };
  const height = await rpc('getBlockHeight', [{ commitment: 'finalized' }]);
  if (height <= attempt.report.lastValidBlockHeight) return { state: 'unresolved', signature: attempt.signature };
  const [valid, chain, wallet] = await Promise.all([
    rpc('isBlockhashValid', [attempt.report.originalBlockhash, { commitment: 'finalized' }]),
    rpc('getTransaction', [attempt.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }]),
    snapshotWallet(attempt.report.before.addresses, 'finalized'),
  ]);
  if (valid.value === false && chain === null && sameWallet(wallet, attempt.report.before)) return { state: 'expired-unspent', signature: attempt.signature };
  return { state: 'unresolved', signature: attempt.signature, reason: 'Expiry without unchanged balances is insufficient evidence' };
}
async function watchAttempt(journal, attempt, rebroadcast) {
  for (let n = 0; n < 25; n++) {
    const result = await observeAttempt(attempt);
    attempt.observation = result; attempt.state = result.state; persist(journal);
    if (terminal.has(result.state)) { const { walletAfter, ...summary } = result; console.log(json(summary)); return result; }
    if (rebroadcast && n % 2 === 1) {
      const height = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]);
      if (height + 2 < attempt.report.lastValidBlockHeight) {
        try { await rpc('sendTransaction', [attempt.wire, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }]); }
        catch { /* The persisted signature remains authoritative after an ambiguous send. */ }
      }
    }
    await delay(2000);
  }
  console.log(json({ signature: attempt.signature, state: 'unresolved', next: 'recover', automaticReplacement: false }));
}
async function execute(symbol, direction) {
  const approved = loadAuthorization(direction);
  const journal = fs.existsSync(journalFile) ? read(journalFile) : { owner: OWNER, authorizationSha256: approved.authorizationSha256, attempts: [] };
  checkJournal(journal, approved.authorizationSha256);
  if (!journal.attempts.length && direction !== 'entry') throw Error('A run must establish its baseline before protective exits');
  const baseline = read(path.join(stateDir, 'portfolio-baseline.json'));
  const expectedWallet = journal.attempts.findLast(a => a.state === 'finalized-and-reconciled')?.observation.walletAfter ?? baseline.wallet;
  if (!expectedWallet) throw Error('Baseline wallet inventory is missing');
  const stopFile = path.join(stateDir, 'portfolio-stop.json');
  if (direction === 'entry' && fs.existsSync(stopFile) && read(stopFile).authorizationSha256 === approved.authorizationSha256)
    throw Error('This run has latched a stop; no new entries are allowed');
  let risk = null;
  if (direction === 'entry') {
    const mark = await markPortfolio();
    if (!sameWallet(mark.wallet, expectedWallet)) throw Error('Wallet changed outside the reconciled run; capital flows require investigation');
    risk = checkEntryRisk(baseline, mark, approved.authorization);
  } else if (!sameWallet(await snapshotWallet([], 'finalized'), expectedWallet))
    throw Error('Wallet changed outside the reconciled run; investigate before protective liquidation');
  const spent = entryReservations(journal.attempts);
  const prepared = await preparePortfolioTrade(symbol, direction, spent);
  if (!sameWallet(prepared.report.before, expectedWallet)) throw Error('Wallet changed after portfolio risk check');
  const currentApproval = loadAuthorization(direction);
  if (currentApproval.authorizationSha256 !== approved.authorizationSha256) throw Error('Authorization changed during preparation');
  checkPortfolioBuild(prepared.report.quote, { ...prepared.context, nowMs: Date.now(), authorization: approved.authorization });
  const now = await snapshotWallet(prepared.report.before.addresses);
  if (!sameWallet(now, prepared.report.before) || Date.now() - prepared.report.startedAtMs > 15_000) throw Error('Wallet or quote changed before signing');
  const height = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]);
  if (height + 15 >= prepared.report.lastValidBlockHeight) throw Error('Blockhash lifetime too short');
  if (loadAuthorization(direction).authorizationSha256 !== approved.authorizationSha256 || Date.now() - prepared.report.startedAtMs > 15_000)
    throw Error('Authorization or quote expired before signing');
  if (direction === 'entry' && fs.existsSync(stopFile) && read(stopFile).authorizationSha256 === approved.authorizationSha256)
    throw Error('Stop latched during preparation; no entry signed');
  const secret = Uint8Array.from(read(path.join(stateDir, 'bot-wallet.json')));
  try {
    const signer = await Keypair.fromSecretKey(secret);
    if (!signer.publicKey.equals(owner)) throw Error('Wrong signing wallet');
    await prepared.tx.sign([signer]);
  } finally { secret.fill(0); }
  const attempt = { state: 'signed-before-send', risk, report: prepared.report, signature: bs58.encode(prepared.tx.signatures[0]), wire: Buffer.from(prepared.tx.serialize()).toString('base64') };
  journal.attempts.push(attempt); persist(journal);
  console.log(json({ state: attempt.state, symbol, direction, signature: attempt.signature }));
  if (loadAuthorization(direction).authorizationSha256 !== approved.authorizationSha256 || Date.now() - prepared.report.startedAtMs > 15_000)
    throw Error('Signed intent persisted but not submitted: authorization or quote expired; recover the original signature');
  if (direction === 'entry' && fs.existsSync(stopFile) && read(stopFile).authorizationSha256 === approved.authorizationSha256)
    throw Error('Signed intent persisted but not submitted: stop latched; recover the original signature');
  try {
    const signature = await rpc('sendTransaction', [attempt.wire, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }]);
    if (signature !== attempt.signature) throw Error('RPC returned a different signature');
  } catch { console.log(json({ state: 'submission-unresolved', signature: attempt.signature })); }
  return watchAttempt(journal, attempt, true);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let lock, acquired = false;
  try {
    const command = process.argv[2];
    if (!['execute', 'recover'].includes(command)) throw Error('Use execute SYMBOL entry|exit|exit-sol, or recover');
    lock = path.join(stateDir, 'execution.lock');
    const fd = fs.openSync(lock, 'wx', 0o600); acquired = true;
    try { fs.writeFileSync(fd, String(process.pid)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (command === 'execute') await execute(process.argv[3], process.argv[4] ?? 'entry');
    else {
      const journal = read(journalFile), attempt = journal.attempts.find(a => !terminal.has(a.state));
      if (!attempt) console.log(json({ state: 'no-unresolved-attempt' }));
      else await watchAttempt(journal, attempt, false);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { if (acquired) fs.unlinkSync(lock); }
}
