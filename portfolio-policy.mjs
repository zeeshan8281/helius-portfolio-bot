import registry from './assets.json' with { type: 'json' };
import { OWNER, USDC, SOL } from './policy.mjs';

export const ENTRY_USDC_ATOMIC = 650_000n;
export const MAX_ENTRY_USDC_ATOMIC = 1_950_000n;
export const MIN_GAS_LAMPORTS = 3_000_000n;
export const MAX_NETWORK_FEE_LAMPORTS = 60_000n;
const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const assets = new Map(registry.assets.filter(a => ['SOL', 'ETH', 'HYPE', 'ZEC'].includes(a.symbol) && a.approvedForIdentityAllowlist === true).map(a => [a.mint, a]));
if (assets.size !== 4 || !assets.has(SOL)) throw Error('Incomplete portfolio identity allowlist');

function amount(value, label) {
  if (typeof value !== 'bigint' || value < 0n) throw Error(`Invalid ${label}`);
  return value;
}
function wireAmount(value, label) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) throw Error(`Invalid ${label}`);
  return BigInt(value);
}
export function checkAuthorization(authorization, nowMs, { protectiveExit = false } = {}) {
  if (!authorization || authorization.approved !== true || !Number.isSafeInteger(nowMs) || nowMs < 0 ||
      !Number.isInteger(authorization.maxLossBps) || authorization.maxLossBps <= 0 || authorization.maxLossBps > 1_000 ||
      !Number.isInteger(authorization.targetBps) || authorization.targetBps < 500 || authorization.targetBps > 1_000)
    throw Error('Explicit loss budget and 5–10 percent target authorization required');
  const until = Date.parse(authorization.authorizedUntilISO);
  if (typeof authorization.authorizedUntilISO !== 'string' || !Number.isSafeInteger(until) ||
      new Date(until).toISOString() !== authorization.authorizedUntilISO || until <= 0 || (protectiveExit !== true && until <= nowMs))
    throw Error('Explicit unexpired authorization time required');
}

export function checkLiveMetadata(metadata, mint, nowMs) {
  const identity = assets.get(mint);
  if (!identity || !Number.isSafeInteger(nowMs) || nowMs < 0 || !metadata || metadata.mint !== mint || !TOKEN_PROGRAMS.includes(metadata.tokenProgram) ||
      (identity.expectedTokenProgram && metadata.tokenProgram !== identity.expectedTokenProgram) ||
      !Number.isInteger(metadata.decimals) || metadata.decimals < 0 || metadata.decimals > 18 ||
      (identity.decimals !== null && metadata.decimals !== identity.decimals) ||
      !Object.hasOwn(metadata, 'mintAuthority') || !(metadata.mintAuthority === null || typeof metadata.mintAuthority === 'string' && metadata.mintAuthority.length > 0) ||
      (Object.hasOwn(identity, 'expectedMintAuthority') && metadata.mintAuthority !== identity.expectedMintAuthority) ||
      (identity.documentedMintAuthority && metadata.mintAuthority !== identity.documentedMintAuthority) || metadata.freezeAuthority !== null ||
      !Array.isArray(metadata.extensions) || metadata.extensions.length !== 0 ||
      !Number.isSafeInteger(metadata.checkedAtMs) || metadata.checkedAtMs < 0 || metadata.checkedAtMs > nowMs || nowMs - metadata.checkedAtMs > 60_000)
    throw Error('Missing, stale, or unsafe live mint metadata');
}

function checkAccount(account, mint, allowMissing, expectedProgram) {
  if (account === null && allowMissing) return;
  if (!account || account.mint !== mint || account.owner !== OWNER || account.state !== 'initialized' ||
      account.delegate !== null || account.delegatedAmount !== 0n || account.closeAuthority !== null || account.tokenProgram !== expectedProgram)
    throw Error('Unsafe token account owner, state, delegate, or close authority');
  amount(account.amountAtomic, 'token account balance');
}

export function checkPortfolioBuild(build, context) {
  // The approved run may close its positions after expiry; it may not open more.
  checkAuthorization(context.authorization, context.nowMs, { protectiveExit: context.direction === 'exit' || context.direction === 'exit-sol' });
  return checkPortfolioQuote(build, context);
}

export function checkPortfolioQuote(build, { nowMs, direction, holdingAtomic, ownedNativeLamports, sellableNativeLamports, spentByMint, liveMetadata, inputAccount, outputAccount }) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw Error('Invalid quote clock');
  if (!['entry', 'exit', 'exit-sol'].includes(direction)) throw Error('Invalid portfolio direction');
  const mint = direction === 'entry' ? build.outputMint : build.inputMint;
  if (!assets.has(mint) || build.inputMint !== (direction === 'entry' ? USDC : mint) ||
      build.outputMint !== (direction === 'entry' ? mint : USDC) || (direction === 'exit-sol') !== (mint === SOL))
    throw Error('Route mint is outside portfolio policy');
  checkLiveMetadata(liveMetadata, mint, nowMs);
  if (direction === 'exit-sol') {
    if (inputAccount !== null) throw Error('Native SOL exit requires a native balance');
  } else checkAccount(inputAccount, build.inputMint, false, direction === 'entry' ? TOKEN_PROGRAMS[0] : liveMetadata.tokenProgram);
  checkAccount(outputAccount, build.outputMint, direction === 'entry', direction === 'entry' ? liveMetadata.tokenProgram : TOKEN_PROGRAMS[0]);
  const input = wireAmount(build.inAmount, 'quote input');
  if (direction !== 'exit-sol' && inputAccount.amountAtomic < input) throw Error('Insufficient input token balance');
  if (direction === 'entry') {
    if (!spentByMint || typeof spentByMint !== 'object' || Array.isArray(spentByMint)) throw Error('Entry ledger required');
    let spent = 0n;
    for (const [key, value] of Object.entries(spentByMint)) {
      if (!assets.has(key) || key === SOL || amount(value, 'entry ledger amount') > ENTRY_USDC_ATOMIC) throw Error('Invalid cumulative entry ledger');
      spent += value;
    }
    if (input !== ENTRY_USDC_ATOMIC || (spentByMint[mint] ?? 0n) + input > ENTRY_USDC_ATOMIC || spent + input > MAX_ENTRY_USDC_ATOMIC)
      throw Error('Per-asset or cumulative entry budget exceeded');
  } else if (direction === 'exit-sol') {
    amount(ownedNativeLamports, 'native SOL balance');
    amount(sellableNativeLamports, 'sellable native SOL');
    if (input === 0n || input !== sellableNativeLamports || input > ownedNativeLamports - MIN_GAS_LAMPORTS)
      throw Error('Native SOL exit violates its sellable amount or gas reserve');
  } else if (input === 0n || input !== amount(holdingAtomic, 'full holding') || inputAccount.amountAtomic !== holdingAtomic)
    throw Error('Exit must sell the full position');
  const output = wireAmount(build.outAmount, 'quote output');
  const minimum = wireAmount(build.otherAmountThreshold, 'minimum output');
  if (build.swapMode !== 'ExactIn' || build.transactionVersion !== 0 || build.slippageBps !== 50 ||
      !Array.isArray(build.routePlan) || build.routePlan.length === 0 || minimum <= 0n || minimum > output || minimum < output * 9950n / 10_000n)
    throw Error('Unexpected mode, version, slippage, or minimum output');
  const impact = typeof build.priceImpactPct === 'string' ? build.priceImpactPct : '';
  if (!/^-?\d+(?:\.\d+)?$/.test(impact) || impact.length > 100) throw Error('Invalid price impact ratio');
  const unsigned = impact.replace(/^-/, '');
  const decimals = unsigned.split('.')[1]?.length ?? 0;
  if (BigInt(unsigned.replace('.', '')) * 100n > 10n ** BigInt(decimals)) throw Error('Price impact exceeds 1 percent');
  if (build.swapInstruction?.programId !== 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' || build.tipInstruction != null ||
      build.tipInstructions != null && (!Array.isArray(build.tipInstructions) || build.tipInstructions.length !== 0))
    throw Error('Unexpected Jupiter program or tip');
  return { mint, inputAtomic: input, minimumOutputAtomic: minimum };
}

export function checkPortfolioSimulation({ direction, inputAtomic, minimumOutputAtomic, beforeInput, afterInput, beforeOutput, afterOutput, beforeSol, afterSol, networkFeeLamports, newOutputAtaRentLamports, verifiedInputAtaRefundLamports }) {
  for (const [key, value] of Object.entries({ inputAtomic, minimumOutputAtomic, beforeOutput, afterOutput, beforeSol, afterSol, networkFeeLamports, newOutputAtaRentLamports, verifiedInputAtaRefundLamports })) amount(value, key);
  if (direction !== 'exit-sol') { amount(beforeInput, 'input balance before'); amount(afterInput, 'input balance after'); }
  if (!['entry', 'exit', 'exit-sol'].includes(direction) || inputAtomic === 0n || minimumOutputAtomic === 0n ||
      (direction !== 'exit-sol' && beforeInput - afterInput !== inputAtomic) || afterOutput - beforeOutput < minimumOutputAtomic)
    throw Error('Simulated token deltas violate the quote');
  if (networkFeeLamports > MAX_NETWORK_FEE_LAMPORTS || afterSol < MIN_GAS_LAMPORTS) throw Error('Network fee or remaining gas violates budget');
  if (direction === 'entry' && (verifiedInputAtaRefundLamports !== 0n || beforeSol - afterSol !== networkFeeLamports + newOutputAtaRentLamports) ||
      direction === 'exit' && (newOutputAtaRentLamports !== 0n || afterSol - beforeSol !== verifiedInputAtaRefundLamports - networkFeeLamports) ||
      direction === 'exit-sol' && (newOutputAtaRentLamports !== 0n || beforeSol - afterSol !== inputAtomic + networkFeeLamports - verifiedInputAtaRefundLamports))
    throw Error('Unexplained native SOL movement');
}
