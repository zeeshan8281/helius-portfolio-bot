import { test } from 'node:test';
import assert from 'node:assert/strict';
import registry from './assets.json' with { type: 'json' };
import { OWNER, USDC, SOL } from './policy.mjs';
import { checkAuthorization, checkLiveMetadata, checkPortfolioQuote, checkPortfolioBuild, checkPortfolioSimulation } from './portfolio-policy.mjs';

const bySymbol = new Map(registry.assets.map(a => [a.symbol, a]));
const eth = bySymbol.get('ETH').mint;
const hype = bySymbol.get('HYPE').mint;
const zec = bySymbol.get('ZEC').mint;
const program = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const authorization = { approved: true, authorizedUntilISO: '2026-10-28T13:00:00.000Z', maxLossBps: 500, targetBps: 500 };
const nowMs = Date.parse('2026-10-28T12:00:00.000Z');
const metadata = symbol => {
  const asset = bySymbol.get(symbol);
  return { mint: asset.mint, tokenProgram: program, decimals: asset.decimals ?? 9, mintAuthority: Object.hasOwn(asset, 'expectedMintAuthority') ? asset.expectedMintAuthority : asset.documentedMintAuthority ?? null, freezeAuthority: null, extensions: [], checkedAtMs: nowMs };
};
const account = (mint, amountAtomic) => ({ mint, owner: OWNER, tokenProgram: program, amountAtomic, state: 'initialized', delegate: null, delegatedAmount: 0n, closeAuthority: null });
const build = overrides => ({ inputMint: USDC, outputMint: eth, inAmount: '650000', outAmount: '100000', otherAmountThreshold: '99500', swapMode: 'ExactIn', transactionVersion: 0, slippageBps: 50, priceImpactPct: '0.001', routePlan: [{}], swapInstruction: { programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' }, ...overrides });
const context = overrides => ({ authorization, nowMs, direction: 'entry', spentByMint: {}, liveMetadata: metadata('ETH'), inputAccount: account(USDC, 2_000_000n), outputAccount: null, ...overrides });
const entrySimulation = overrides => ({ direction: 'entry', inputAtomic: 650_000n, minimumOutputAtomic: 99_500n, beforeInput: 2_000_000n, afterInput: 1_350_000n, beforeOutput: 0n, afterOutput: 100_000n, beforeSol: 14_849_159n, afterSol: 13_310_719n, networkFeeLamports: 50_000n, newOutputAtaRentLamports: 1_488_440n, verifiedInputAtaRefundLamports: 0n, ...overrides });

test('pending, missing, expired, or excessive risk authorization fails closed', () => {
  assert.doesNotThrow(() => checkAuthorization(authorization, nowMs));
  for (const auth of [undefined, { ...authorization, approved: false }, { ...authorization, authorizedUntilISO: undefined }, { ...authorization, authorizedUntilISO: '2026-10-28T12:00:00.000Z' }, { ...authorization, maxLossBps: 0 }, { ...authorization, maxLossBps: 1_001 }, { ...authorization, targetBps: 499 }, { ...authorization, targetBps: 1_001 }])
    assert.throws(() => checkAuthorization(auth, nowMs));
  assert.throws(() => checkAuthorization(authorization, NaN));
});

test('read-only quote validation needs no fabricated approval but execution build remains gated', () => {
  const pending = context({ authorization: undefined });
  assert.doesNotThrow(() => checkPortfolioQuote(build(), pending));
  assert.throws(() => checkPortfolioBuild(build(), pending), /authorization/);
  assert.throws(() => checkPortfolioQuote(build({ inAmount: '650001' }), pending), /budget/);
  assert.throws(() => checkPortfolioQuote(build(), { ...pending, nowMs: NaN }), /clock/);
});

test('expiry prohibits new entries but preserves approved close-only liquidation with fresh evidence', () => {
  const afterDeadline = Date.parse(authorization.authorizedUntilISO) + 1;
  const freshEth = { ...metadata('ETH'), checkedAtMs: afterDeadline };
  assert.throws(() => checkAuthorization(authorization, afterDeadline, { protectiveExit: 'true' }), /authorization time/);
  assert.throws(() => checkPortfolioBuild(build(), context({ nowMs: afterDeadline, liveMetadata: freshEth })), /authorization time/);
  const exit = build({ inputMint: eth, outputMint: USDC, inAmount: '100000' });
  const closeContext = context({ nowMs: afterDeadline, direction: 'exit', holdingAtomic: 100_000n, inputAccount: account(eth, 100_000n), outputAccount: account(USDC, 2_000_000n), liveMetadata: freshEth });
  assert.doesNotThrow(() => checkPortfolioBuild(exit, closeContext));
  assert.throws(() => checkPortfolioBuild({ ...exit, inAmount: '99999' }, closeContext), /full position/);
  assert.throws(() => checkPortfolioBuild({ ...exit, outputMint: hype }, closeContext), /mint/);
  assert.throws(() => checkPortfolioBuild(exit, { ...closeContext, authorization: { ...authorization, approved: false } }), /authorization/);
  assert.throws(() => checkPortfolioBuild(exit, { ...closeContext, authorization: { ...authorization, maxLossBps: 0 } }), /authorization/);
  assert.throws(() => checkPortfolioBuild(exit, { ...closeContext, authorization: { ...authorization, authorizedUntilISO: 'PENDING' } }), /authorization time/);
  const native = build({ inputMint: SOL, outputMint: USDC, inAmount: '11800000' });
  assert.doesNotThrow(() => checkPortfolioBuild(native, context({ nowMs: afterDeadline, direction: 'exit-sol', ownedNativeLamports: 14_849_159n, sellableNativeLamports: 11_800_000n, liveMetadata: { ...metadata('SOL'), checkedAtMs: afterDeadline }, inputAccount: null, outputAccount: account(USDC, 2_000_000n) })));
});

test('only exact allowed USDC entries fit the per-asset and total ledger budgets', () => {
  assert.doesNotThrow(() => checkPortfolioBuild(build(), context()));
  assert.doesNotThrow(() => checkPortfolioBuild(build(), context({ spentByMint: { [hype]: 650_000n, [zec]: 650_000n } })));
  assert.throws(() => checkPortfolioBuild(build({ inAmount: '650001' }), context()), /budget/);
  assert.throws(() => checkPortfolioBuild(build({ inAmount: '649999' }), context()), /budget/);
  assert.throws(() => checkPortfolioBuild(build(), context({ spentByMint: { [eth]: 650_000n, [hype]: 650_000n, [zec]: 650_000n } })), /budget/);
  assert.throws(() => checkPortfolioBuild(build(), context({ spentByMint: { [hype]: 650_001n } })), /ledger/);
  assert.throws(() => checkPortfolioBuild(build(), context({ spentByMint: { fake: 1n } })), /ledger/);
  assert.throws(() => checkPortfolioBuild(build(), context({ spentByMint: undefined })), /ledger/);
  assert.throws(() => checkPortfolioBuild(build({ outputMint: SOL }), context()), /mint/);
  assert.throws(() => checkPortfolioBuild(build({ inputMint: hype }), context()), /mint/);
});

test('entry identity checks accept the three exact mint addresses, not ticker lookalikes', () => {
  for (const symbol of ['ETH', 'HYPE', 'ZEC']) {
    const mint = bySymbol.get(symbol).mint;
    assert.doesNotThrow(() => checkPortfolioBuild(build({ outputMint: mint }), context({ liveMetadata: metadata(symbol) })));
  }
  assert.throws(() => checkPortfolioBuild(build({ outputMint: 'ETH' }), context()), /mint/);
});

test('minimum outputs, impact, program, mode, version, and tips remain bounded', () => {
  for (const override of [{ otherAmountThreshold: '99499' }, { otherAmountThreshold: '100001' }, { otherAmountThreshold: '0' }, { priceImpactPct: '0.0100000001' }, { priceImpactPct: '-0.0100000001' }, { priceImpactPct: 'NaN' }, { priceImpactPct: '1e-4' }, { priceImpactPct: 0.001 }, { transactionVersion: 1 }, { slippageBps: 51 }, { swapMode: 'ExactOut' }, { routePlan: [] }, { inAmount: 650_000 }, { tipInstruction: {} }, { tipInstructions: [{}] }, { swapInstruction: { programId: 'wrong' } }])
    assert.throws(() => checkPortfolioBuild(build(override), context()));
  assert.doesNotThrow(() => checkPortfolioBuild(build({ priceImpactPct: '-0.0100' }), context()));
});

test('live metadata rejects absent fields, stale observations, freezes, extensions, and wrong mint/program/decimals', () => {
  for (const override of [{ mint: hype }, { tokenProgram: 'wrong' }, { decimals: 9 }, { freezeAuthority: 'freeze' }, { freezeAuthority: undefined }, { extensions: ['transferFee'] }, { extensions: undefined }, { mintAuthority: undefined }, { checkedAtMs: nowMs - 60_001 }, { checkedAtMs: nowMs + 1 }])
    assert.throws(() => checkLiveMetadata({ ...metadata('ETH'), ...override }, eth, nowMs), /metadata/);
  assert.throws(() => checkLiveMetadata({ ...metadata('HYPE'), mintAuthority: 'wrong' }, hype, nowMs), /metadata/);
  assert.throws(() => checkLiveMetadata(metadata('ETH'), eth, NaN), /metadata/);
});

test('input and existing output accounts must remain undelegated, unfrozen, and owned by the bot', () => {
  for (const override of [{ owner: 'someone else' }, { state: 'frozen' }, { delegate: 'delegate' }, { delegatedAmount: 1n }, { delegatedAmount: undefined }, { delegatedAmount: 0 }, { closeAuthority: 'authority' }, { tokenProgram: 'wrong' }, { delegate: undefined }, { amountAtomic: 0n }])
    assert.throws(() => checkPortfolioBuild(build(), context({ inputAccount: { ...account(USDC, 2_000_000n), ...override } })));
  assert.throws(() => checkPortfolioBuild(build(), context({ outputAccount: { ...account(eth, 0n), delegate: 'delegate' } })), /account/);
  assert.throws(() => checkPortfolioBuild(build(), context({ outputAccount: { ...account(eth, 0n), delegatedAmount: 1n } })), /account/);
});

test('token exits must sell the full actual holding into canonical USDC', () => {
  const exit = build({ inputMint: eth, outputMint: USDC, inAmount: '100000' });
  const ctx = context({ direction: 'exit', holdingAtomic: 100_000n, inputAccount: account(eth, 100_000n), outputAccount: account(USDC, 2_000_000n) });
  assert.doesNotThrow(() => checkPortfolioBuild(exit, ctx));
  assert.throws(() => checkPortfolioBuild({ ...exit, inAmount: '99999' }, ctx), /full position/);
  assert.throws(() => checkPortfolioBuild(exit, { ...ctx, holdingAtomic: 99_999n }), /full position/);
  assert.throws(() => checkPortfolioBuild({ ...exit, outputMint: hype }, ctx), /mint/);
  assert.throws(() => checkPortfolioBuild(exit, { ...ctx, outputAccount: null }), /account/);
});

test('native SOL can only exit for the explicitly defined sellable balance above the gas reserve', () => {
  const native = build({ inputMint: SOL, outputMint: USDC, inAmount: '11800000' });
  const ctx = context({ direction: 'exit-sol', ownedNativeLamports: 14_849_159n, sellableNativeLamports: 11_800_000n, liveMetadata: metadata('SOL'), inputAccount: null, outputAccount: account(USDC, 2_000_000n) });
  assert.doesNotThrow(() => checkPortfolioBuild(native, ctx));
  assert.throws(() => checkPortfolioBuild({ ...native, inAmount: '11800001' }, ctx), /sellable/);
  assert.throws(() => checkPortfolioBuild({ ...native, inAmount: '11849160' }, { ...ctx, sellableNativeLamports: 11_849_160n }), /reserve/);
  assert.throws(() => checkPortfolioBuild(native, { ...ctx, direction: 'exit' }), /mint/);
});

test('entry simulation permits only the exact fee and expected new-account deposit native debit', () => {
  assert.doesNotThrow(() => checkPortfolioSimulation(entrySimulation()));
  assert.throws(() => checkPortfolioSimulation(entrySimulation({ afterInput: 1_349_999n })), /token deltas/);
  assert.throws(() => checkPortfolioSimulation(entrySimulation({ afterOutput: 99_499n })), /token deltas/);
  assert.throws(() => checkPortfolioSimulation(entrySimulation({ afterSol: 13_310_718n })), /native/);
  assert.throws(() => checkPortfolioSimulation(entrySimulation({ networkFeeLamports: 60_001n })), /fee/);
  assert.throws(() => checkPortfolioSimulation(entrySimulation({ afterSol: 2_999_999n })), /gas/);
  assert.throws(() => checkPortfolioSimulation(entrySimulation({ verifiedInputAtaRefundLamports: 1n })), /native/);
});

test('token exit simulation requires exactly the verified native refund minus network fee', () => {
  const exit = entrySimulation({ direction: 'exit', beforeInput: 650_000n, afterInput: 0n, beforeOutput: 2_000_000n, afterOutput: 2_100_000n, afterSol: 16_287_599n, newOutputAtaRentLamports: 0n, verifiedInputAtaRefundLamports: 1_488_440n });
  assert.doesNotThrow(() => checkPortfolioSimulation(exit));
  assert.throws(() => checkPortfolioSimulation({ ...exit, afterSol: exit.afterSol - 1n }), /native/);
  assert.throws(() => checkPortfolioSimulation({ ...exit, afterSol: exit.afterSol + 1n }), /native/);
  assert.throws(() => checkPortfolioSimulation({ ...exit, newOutputAtaRentLamports: 1n }), /native/);
});

test('native SOL exit accounts for sold principal, fee, optional verified refund, and remaining gas', () => {
  const native = entrySimulation({ direction: 'exit-sol', inputAtomic: 11_800_000n, beforeInput: undefined, afterInput: undefined, beforeOutput: 2_000_000n, afterOutput: 2_100_000n, afterSol: 3_000_000n, networkFeeLamports: 49_159n, newOutputAtaRentLamports: 0n });
  assert.doesNotThrow(() => checkPortfolioSimulation(native));
  assert.throws(() => checkPortfolioSimulation({ ...native, afterSol: 2_999_999n }), /gas/);
  assert.throws(() => checkPortfolioSimulation({ ...native, afterSol: 3_000_001n }), /native/);
  assert.doesNotThrow(() => checkPortfolioSimulation({ ...native, verifiedInputAtaRefundLamports: 1_488_440n, afterSol: 4_488_440n }));
});
