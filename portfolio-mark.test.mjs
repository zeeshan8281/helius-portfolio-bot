import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import registry from './assets.json' with { type: 'json' };
import { OWNER, USDC, SOL } from './policy.mjs';
import { portfolioQuotePlan, parseExitQuote, buildPortfolioMark, compareBaseline, saveBaseline } from './portfolio-mark.mjs';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const [eth, hype, zec] = ['ETH', 'HYPE', 'ZEC'].map(symbol => registry.assets.find(a => a.symbol === symbol).mint);
const token = (mint, amountAtomic) => ({ mint, amountAtomic, lamports: 1_488_440n, owner: OWNER, tokenProgram: TOKEN, state: 'initialized', delegate: null, delegatedAmount: 0n, closeAuthority: null });
const snapshot = () => ({ slot: 100, nativeLamports: 14_000_000n, tokenAccounts: { usdc: token(USDC, 2_000_000n), eth: token(eth, 1_000n), hype: token(hype, 2_000n), zec: token(zec, 3_000n) } });
function quotesFor(wallet, nowMs = 1_000) {
  return portfolioQuotePlan(wallet).requests.map(r => {
    const outUsdcAtomic = r.id === `holding:${SOL}` ? 1_400_000n : r.id === `holding:${eth}` ? 700_000n : r.id === `holding:${hype}` ? 650_000n : r.id === `holding:${zec}` ? 600_000n : r.id === 'account-deposits' ? 600_000n : 1_076_000n;
    return { id: r.id, mint: r.mint, inputAtomic: r.amountAtomic, outUsdcAtomic, minOutUsdcAtomic: outUsdcAtomic * 9950n / 10_000n, observedAtMs: nowMs };
  });
}
const mark = () => buildPortfolioMark(snapshot(), quotesFor(snapshot()), 1_000);

test('full bid includes the whole basket and separately marked account deposits; spendable exits reserve all fees and gas', () => {
  const report = mark();
  assert.equal(report.bidMarkedUsdcAtomic, 5_950_000n);
  assert.equal(report.bidMinimumMarkedUsdcAtomic, 5_930_250n);
  assert.equal(report.accountDepositsBidUsdcAtomic, 600_000n);
  assert.equal(report.tokenRentLamports, 5_953_760n);
  assert.equal(report.gasReserveLamports, 3_000_000n);
  assert.equal(report.feeBudgetLamports, 240_000n);
  assert.equal(report.feeBudgetUsdcAtomic, 24_000n);
  assert.equal(report.wallet.nativeLamports, 14_000_000n);
  assert.equal(report.wallet.tokenAccounts.eth.amountAtomic, 1_000n);
  assert.equal(report.sellableNativeLamports, 10_760_000n);
  assert.equal(report.conservativeLiquidationUsdcAtomic, 5_010_870n);
  assert.equal(report.realizedReturn, null);
  assert.equal(report.confidence, 'quote-only');
});

test('unknown, extended, delegated, frozen, or persistently wrapped holdings stop valuation', () => {
  for (const account of [token('unknown-mint', 1n), { ...token(eth, 1n), tokenProgram: 'Token2022' }, { ...token(eth, 1n), delegatedAmount: 1n }, { ...token(eth, 1n), state: 'frozen' }, token(SOL, 1n)])
    assert.throws(() => portfolioQuotePlan({ ...snapshot(), tokenAccounts: { extra: account } }));
});

test('missing, stale, future-dated, duplicate, and wrong-sized quotes cannot produce a mark', () => {
  const wallet = snapshot(), quotes = quotesFor(wallet);
  assert.throws(() => buildPortfolioMark(wallet, quotes.slice(1), 1_000), /Missing/);
  assert.throws(() => buildPortfolioMark(wallet, quotes, 31_001), /stale/);
  assert.throws(() => buildPortfolioMark(wallet, quotes, 999), /stale/);
  assert.throws(() => buildPortfolioMark(wallet, [quotes[0], quotes[0], ...quotes.slice(2)], 1_000), /Duplicate/);
  assert.throws(() => buildPortfolioMark(wallet, [{ ...quotes[0], inputAtomic: 1n }, ...quotes.slice(1)], 1_000), /wrong-size/);
});

test('insufficient native gas preserves a bid estimate but cannot claim a spendable liquidation', () => {
  const wallet = { ...snapshot(), nativeLamports: 3_100_000n };
  const report = buildPortfolioMark(wallet, quotesFor(wallet), 1_000);
  assert.equal(report.confidence, 'liquidation-unknown');
  assert.equal(report.conservativeLiquidationUsdcAtomic, null);
  assert.equal(report.sellableNativeLamports, 0n);
  assert.equal(report.bidMarkedUsdcAtomic, 5_950_000n);
});

test('raw quotes must be full-size canonical USDC exits with bounded minimum output and impact', () => {
  const request = { id: `holding:${eth}`, mint: eth, amountAtomic: 1_000n };
  const good = { inputMint: eth, outputMint: USDC, inAmount: '1000', outAmount: '700000', otherAmountThreshold: '696500', swapMode: 'ExactIn', slippageBps: 50, transactionVersion: 0, routePlan: [{ swapInfo: { label: 'fixture route' } }], priceImpactPct: '0.001', swapInstruction: { programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' } };
  assert.equal(parseExitQuote(good, request, 1_000).inputAtomic, 1_000n);
  for (const changes of [{ outputMint: hype }, { inputMint: zec }, { inAmount: '999' }, { otherAmountThreshold: '696499' }, { priceImpactPct: '0.010000001' }, { priceImpactPct: 'unknown' }, { tipInstructions: [{}] }])
    assert.throws(() => parseExitQuote({ ...good, ...changes }, request, 1_000));
});

test('an identical basket can show quote movement while trading and realized profit stay unknown', () => {
  const baseline = mark();
  const current = { ...mark(), slot: 101, observedAt: '1970-01-01T00:00:02.000Z', bidMarkedUsdcAtomic: baseline.bidMarkedUsdcAtomic + 59_500n };
  const result = compareBaseline(JSON.parse(JSON.stringify(baseline, (_, v) => typeof v === 'bigint' ? v.toString() : v)), current);
  assert.equal(result.status, 'unchanged-basket-quote-comparison');
  assert.equal(result.basketQuoteReturnBps, 100n);
  assert.equal(result.adjustedTradingProfitUsdcAtomic, null);
  assert.equal(result.realizedReturn, null);
});

test('a deposit, withdrawal, trade, or account-rent change blocks adjusted return without a reconciled journal', () => {
  const baseline = mark();
  const wallet = snapshot();
  wallet.nativeLamports += 1n;
  assert.equal(compareBaseline(baseline, buildPortfolioMark(wallet, quotesFor(wallet), 1_000)).status, 'unreconciled-wallet-change');
  const rentChange = { ...mark(), tokenRentLamports: baseline.tokenRentLamports + 1n };
  const result = compareBaseline(baseline, rentChange);
  assert.equal(result.status, 'unreconciled-wallet-change');
  assert.equal(result.adjustedTradingProfitUsdcAtomic, null);
  assert.equal(result.returnBps, null);
  assert.equal(compareBaseline({ ...baseline, bidIncludesAccountDeposits: false }, mark()).status, 'unknown');
  assert.equal(compareBaseline({ schema: 'malformed' }, mark()).status, 'unknown');
});

test('baseline creation is explicit, exclusive, durable, hashed, and never overwrites a prior baseline', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helius-mark-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'baseline.json');
  const result = await saveBaseline(mark(), file);
  const bytes = fs.readFileSync(file);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  await assert.rejects(saveBaseline(mark(), file), /EEXIST/);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  await assert.rejects(saveBaseline({ ...mark(), confidence: 'unknown' }, path.join(directory, 'bad.json')), /complete/);
});
