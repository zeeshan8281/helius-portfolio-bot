import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import registry from './assets.json' with { type: 'json' };
import { OWNER, USDC, SOL } from './policy.mjs';
import { MIN_GAS_LAMPORTS, MAX_NETWORK_FEE_LAMPORTS } from './portfolio-policy.mjs';
import { liquidationValue, portfolioReturn } from './portfolio-accounting.mjs';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const assets = [{ symbol: 'USDC', mint: USDC }, ...registry.assets];
const allowed = new Set(assets.map(a => a.mint));
const MAX_QUOTE_AGE_MS = 30_000;
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
let lastQuoteStartedAt = 0;
function atomic(value) {
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) return BigInt(value);
  throw Error('Invalid exact atomic amount');
}

export function portfolioQuotePlan(snapshot) {
  if (!Number.isSafeInteger(snapshot.slot) || snapshot.slot < 0 || typeof snapshot.nativeLamports !== 'bigint') throw Error('Invalid finalized wallet snapshot');
  const nativeLamports = atomic(snapshot.nativeLamports);
  const amounts = new Map(assets.map(a => [a.mint, 0n]));
  amounts.set(SOL, nativeLamports);
  const accountDeposits = [];
  for (const [address, account] of Object.entries(snapshot.tokenAccounts)) {
    if (!account) continue;
    if (!allowed.has(account.mint) || account.tokenProgram !== TOKEN || account.owner !== OWNER || account.state !== 'initialized' ||
        account.delegate !== null || account.delegatedAmount !== 0n || account.closeAuthority !== null)
      throw Error('Unknown or unsafe owned token account; valuation confidence is unknown');
    const amountAtomic = atomic(account.amountAtomic), lamports = atomic(account.lamports);
    if (account.mint === SOL && amountAtomic > 0n) throw Error('Persistent wrapped SOL needs a separately verified redemption plan');
    amounts.set(account.mint, amounts.get(account.mint) + amountAtomic);
    accountDeposits.push({ address, mint: account.mint, amountAtomic, lamports });
  }
  accountDeposits.sort((a, b) => a.address.localeCompare(b.address));
  const holdings = assets.map(a => ({ symbol: a.symbol, mint: a.mint, amountAtomic: amounts.get(a.mint) }));
  const tokenRentLamports = accountDeposits.reduce((n, a) => n + a.lamports, 0n);
  const tokenExits = holdings.filter(a => ![USDC, SOL].includes(a.mint) && a.amountAtomic > 0n).length;
  const canExitSol = nativeLamports > MIN_GAS_LAMPORTS + MAX_NETWORK_FEE_LAMPORTS * BigInt(tokenExits + 1);
  const feeBudgetLamports = MAX_NETWORK_FEE_LAMPORTS * BigInt(tokenExits + (canExitSol ? 1 : 0));
  const canFundExits = nativeLamports >= MIN_GAS_LAMPORTS + feeBudgetLamports;
  const sellableNativeLamports = canExitSol ? nativeLamports - MIN_GAS_LAMPORTS - feeBudgetLamports : 0n;
  const requests = holdings.filter(a => a.mint !== USDC && a.amountAtomic > 0n).map(a => ({ id: `holding:${a.mint}`, mint: a.mint, amountAtomic: a.amountAtomic }));
  if (tokenRentLamports > 0n) requests.push({ id: 'account-deposits', mint: SOL, amountAtomic: tokenRentLamports });
  if (sellableNativeLamports > 0n) requests.push({ id: 'spendable-sol', mint: SOL, amountAtomic: sellableNativeLamports });
  return { holdings, nativeLamports, accountDeposits, tokenRentLamports, feeBudgetLamports, sellableNativeLamports, canFundExits, requests };
}

export function parseExitQuote(build, request, observedAtMs) {
  const inputAtomic = atomic(build.inAmount), outUsdcAtomic = atomic(build.outAmount), minOutUsdcAtomic = atomic(build.otherAmountThreshold);
  if (build.inputMint !== request.mint || build.outputMint !== USDC || inputAtomic !== request.amountAtomic ||
      build.swapMode !== 'ExactIn' || build.slippageBps !== 50 || build.transactionVersion !== 0 ||
      !Array.isArray(build.routePlan) || !build.routePlan.length || minOutUsdcAtomic <= 0n || minOutUsdcAtomic > outUsdcAtomic ||
      minOutUsdcAtomic < outUsdcAtomic * 9950n / 10_000n || build.tipInstruction != null ||
      build.tipInstructions != null && (!Array.isArray(build.tipInstructions) || build.tipInstructions.length !== 0) ||
      build.swapInstruction?.programId !== 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4') throw Error('Invalid exact-size USDC exit quote');
  const impact = typeof build.priceImpactPct === 'string' ? build.priceImpactPct.replace(/^-/, '') : '';
  if (!/^\d+(?:\.\d+)?$/.test(impact) || impact.length > 100 ||
      BigInt(impact.replace('.', '')) * 100n > 10n ** BigInt(impact.split('.')[1]?.length ?? 0)) throw Error('Exit quote price impact exceeds policy or is unknown');
  return { id: request.id, mint: request.mint, inputAtomic, outUsdcAtomic, minOutUsdcAtomic, observedAtMs, route: build.routePlan.map(p => p.swapInfo?.label ?? 'unknown') };
}

export function buildPortfolioMark(snapshot, quotes, nowMs) {
  const plan = portfolioQuotePlan(snapshot);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Array.isArray(quotes) || quotes.length !== plan.requests.length) throw Error('Missing quotes or invalid quote clock');
  const byId = new Map(quotes.map(q => [q.id, q]));
  if (byId.size !== quotes.length) throw Error('Duplicate exit quote');
  for (const request of plan.requests) {
    const q = byId.get(request.id);
    if (!q || q.mint !== request.mint || atomic(q.inputAtomic) !== request.amountAtomic || atomic(q.minOutUsdcAtomic) === 0n ||
        atomic(q.minOutUsdcAtomic) > atomic(q.outUsdcAtomic) || !Number.isSafeInteger(q.observedAtMs) || q.observedAtMs < 0 ||
        q.observedAtMs > nowMs || nowMs - q.observedAtMs > MAX_QUOTE_AGE_MS) throw Error('Missing, stale, or wrong-size exit quote');
  }
  const usdcAtomic = plan.holdings.find(a => a.mint === USDC).amountAtomic;
  const bidMarkedUsdcAtomic = usdcAtomic + plan.requests.filter(r => r.id !== 'spendable-sol').reduce((n, r) => n + atomic(byId.get(r.id).outUsdcAtomic), 0n);
  const bidMinimumMarkedUsdcAtomic = usdcAtomic + plan.requests.filter(r => r.id !== 'spendable-sol').reduce((n, r) => n + atomic(byId.get(r.id).minOutUsdcAtomic), 0n);
  const feeBudgetUsdcAtomic = plan.feeBudgetLamports === 0n ? 0n : plan.nativeLamports > 0n
    ? (plan.feeBudgetLamports * atomic(byId.get(`holding:${SOL}`).outUsdcAtomic) + plan.nativeLamports - 1n) / plan.nativeLamports : null;
  const positions = plan.holdings.filter(a => ![USDC, SOL].includes(a.mint) && a.amountAtomic > 0n).map(a => ({ asset: a.mint, amountAtomic: a.amountAtomic, quote: byId.get(`holding:${a.mint}`) }));
  if (plan.sellableNativeLamports > 0n) positions.push({ asset: SOL, amountAtomic: plan.sellableNativeLamports, quote: byId.get('spendable-sol') });
  // Fees are withheld in native SOL before quoting; subtracting a USDC fee again would double count.
  const conservativeLiquidationUsdcAtomic = plan.canFundExits ? liquidationValue({ usdcAtomic, positions, exitFeeUsdcAtomic: 0n, recoverableRentLamports: plan.tokenRentLamports, nowMs, maxQuoteAgeMs: MAX_QUOTE_AGE_MS }).netUsdcAtomic : null;
  return { schema: 'helius-portfolio-mark-v1', observedAt: new Date(nowMs).toISOString(), owner: OWNER, slot: snapshot.slot,
    wallet: snapshot,
    holdings: plan.holdings, nativeLamports: plan.nativeLamports, tokenRentLamports: plan.tokenRentLamports, accountDeposits: plan.accountDeposits,
    quotes, bidMarkedUsdcAtomic, bidMinimumMarkedUsdcAtomic, conservativeLiquidationUsdcAtomic, gasReserveLamports: MIN_GAS_LAMPORTS,
    feeBudgetLamports: plan.feeBudgetLamports, feeBudgetUsdcAtomic,
    feeBudgetUsdcMethod: 'Estimated ceil(network fee cap lamports × full native SOL quote expected USDC / native lamports); not a paid fee or an executable conversion bound',
    accountDepositsBidUsdcAtomic: plan.tokenRentLamports > 0n ? atomic(byId.get('account-deposits').outUsdcAtomic) : 0n,
    sellableNativeLamports: plan.sellableNativeLamports, withheldNativeLamports: plan.nativeLamports - plan.sellableNativeLamports,
    bidIncludesAccountDeposits: true, realizedReturn: null,
    confidence: plan.canFundExits ? 'quote-only' : 'liquidation-unknown',
    limits: [
      'Bid mark includes separately quoted token-account SOL deposits; their recovery is hypothetical until a close-account simulation proves it.',
      'Spendable quote excludes locked gas and account deposits and withholds at most 60000 native lamports per required exit; the unused fee reserve remains SOL.',
      'Quotes are neither fills nor verified executable liquidation. Setup, consolidation, account closure, and actual fees require complete simulation.',
      'No reconciled run journal or capital-flow history is supplied; wallet changes cannot be attributed to trading rather than deposits or withdrawals.',
    ] };
}

function basketIdentity(report) {
  return json({ owner: report.owner, holdings: report.holdings.map(a => [a.mint, atomic(a.amountAtomic).toString()]).sort(),
    accounts: report.accountDeposits.map(a => [a.address, a.mint, atomic(a.amountAtomic).toString(), atomic(a.lamports).toString()]).sort(),
    nativeLamports: atomic(report.nativeLamports).toString(), tokenRentLamports: atomic(report.tokenRentLamports).toString() });
}

export function compareBaseline(baseline, current) {
  try {
    if (baseline.schema !== 'helius-portfolio-mark-v1' || baseline.owner !== OWNER || current.owner !== OWNER || baseline.confidence !== 'quote-only' ||
        baseline.bidIncludesAccountDeposits !== true || current.bidIncludesAccountDeposits !== true || !Number.isSafeInteger(baseline.slot) ||
        !Number.isSafeInteger(current.slot) || current.slot < baseline.slot || !Number.isFinite(Date.parse(baseline.observedAt)) || Date.parse(baseline.observedAt) > Date.parse(current.observedAt)) throw Error('Invalid baseline');
    if (basketIdentity(baseline) !== basketIdentity(current)) return { status: 'unreconciled-wallet-change', adjustedTradingProfitUsdcAtomic: null, returnBps: null,
      reason: 'Exact starting holdings or account deposits changed; a reconciled run journal and capital-flow history are required' };
    const result = portfolioReturn({ baselineUsdcAtomic: atomic(baseline.bidMarkedUsdcAtomic), currentUsdcAtomic: atomic(current.bidMarkedUsdcAtomic), depositsUsdcAtomic: 0n, withdrawalsUsdcAtomic: 0n });
    return { status: 'unchanged-basket-quote-comparison', bidValueChangeUsdcAtomic: result.profitUsdcAtomic, basketQuoteReturnBps: result.returnBps,
      adjustedTradingProfitUsdcAtomic: null, realizedReturn: null, reason: 'Only the market quote for the same held basket changed; this is not realized trading performance' };
  } catch { return { status: 'unknown', adjustedTradingProfitUsdcAtomic: null, reason: 'Baseline identity, value, slot, or rent treatment could not be validated' }; }
}

export async function saveBaseline(report, file) {
  if (report.schema !== 'helius-portfolio-mark-v1' || report.owner !== OWNER || report.confidence !== 'quote-only' || report.bidIncludesAccountDeposits !== true)
    throw Error('A complete quote-only mark is required before baseline creation');
  atomic(report.bidMarkedUsdcAtomic);
  basketIdentity(report);
  if (!file) file = path.join((await import('./bot.mjs')).stateDir, 'portfolio-baseline.json');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const bytes = json(report) + '\n';
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return { file, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function markPortfolio() {
  const [{ snapshotWallet }, { requestBuild, stateDir }] = await Promise.all([import('./portfolio-prepare.mjs'), import('./bot.mjs')]);
  const snapshot = await snapshotWallet([], 'finalized');
  const plan = portfolioQuotePlan(snapshot), quotes = [];
  for (const request of plan.requests) {
    await delay(Math.max(0, 2300 - (Date.now() - lastQuoteStartedAt)));
    lastQuoteStartedAt = Date.now();
    const build = await requestBuild({ inputMint: request.mint, outputMint: USDC, amount: request.amountAtomic.toString(), taker: OWNER, slippageBps: '50', transactionVersion: '0' });
    quotes.push(parseExitQuote(build, request, lastQuoteStartedAt));
  }
  const after = await snapshotWallet([], 'finalized');
  if (json(portfolioQuotePlan(after).holdings) !== json(plan.holdings) || json(portfolioQuotePlan(after).accountDeposits) !== json(plan.accountDeposits))
    throw Error('Wallet changed during quote collection; mark confidence is unknown');
  const report = buildPortfolioMark(after, quotes, Date.now());
  const file = path.join(stateDir, 'portfolio-baseline.json');
  if (fs.existsSync(file)) {
    try { const bytes = fs.readFileSync(file, 'utf8'); report.baselineComparison = { file, sha256: createHash('sha256').update(bytes).digest('hex'), ...compareBaseline(JSON.parse(bytes), report) }; }
    catch { report.baselineComparison = { status: 'unknown', adjustedTradingProfitUsdcAtomic: null, reason: 'Saved baseline is invalid; current mark remains quote-only' }; }
  } else report.baselineComparison = { status: 'not-established', adjustedTradingProfitUsdcAtomic: null };
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).some(a => a !== '--baseline')) throw Error('Use node portfolio-mark.mjs [--baseline]');
    const report = await markPortfolio();
    if (process.argv.includes('--baseline')) report.savedBaseline = await saveBaseline(report);
    console.log(json(report));
  } catch (error) { console.error(json({ confidence: 'unknown', realizedReturn: null, error: error.message })); process.exitCode = 1; }
}
