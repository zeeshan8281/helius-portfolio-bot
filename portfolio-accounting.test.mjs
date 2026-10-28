import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liquidationValue, portfolioReturn, evaluatePortfolio } from './portfolio-accounting.mjs';

const position = (asset, amountAtomic, outUsdcAtomic, minOutUsdcAtomic = outUsdcAtomic) => ({
  asset, amountAtomic, quote: { inputAtomic: amountAtomic, outUsdcAtomic, minOutUsdcAtomic, observedAtMs: 1_000 },
});
const value = overrides => liquidationValue({ usdcAtomic: 2_000_000n, positions: [position('SOL', 10_000_000n, 1_110_000n, 1_100_000n)], exitFeeUsdcAtomic: 10_000n, recoverableRentLamports: 1_488_440n, nowMs: 2_000, maxQuoteAgeMs: 5_000, ...overrides });
const returns = overrides => portfolioReturn({ baselineUsdcAtomic: 3_000_000n, depositsUsdcAtomic: 0n, withdrawalsUsdcAtomic: 0n, currentUsdcAtomic: 3_000_000n, ...overrides });

test('liquidation uses exact full-size quote minima, subtracts exit fees, and keeps rent illiquid', () => {
  assert.deepEqual(value(), { grossUsdcAtomic: 3_100_000n, exitFeeUsdcAtomic: 10_000n, netUsdcAtomic: 3_090_000n, recoverableRentLamports: 1_488_440n, rentRefundUsdcAtomic: 0n });
  assert.equal(value({ recoverableRentLamports: 0n }).netUsdcAtomic, value().netUsdcAtomic);
});

test('rent contributes to exit proceeds only after closure is verified', () => {
  assert.throws(() => value({ rentRefundUsdcAtomic: 150_000n }), /verified account closure/);
  assert.throws(() => value({ rentRefundUsdcAtomic: 150_000n, rentClosureVerified: true, recoverableRentLamports: 0n }), /verified account closure/);
  const result = value({ rentRefundUsdcAtomic: 150_000n, rentClosureVerified: true });
  assert.equal(result.netUsdcAtomic, 3_240_000n);
  assert.equal(result.rentRefundUsdcAtomic, 150_000n);
});

test('a nonzero position without a fresh full-position exit quote fails closed', () => {
  assert.throws(() => value({ positions: [{ asset: 'ZEC', amountAtomic: 1n }] }), /Missing exit quote/);
  assert.throws(() => value({ nowMs: 7_000 }), /Stale/);
  assert.throws(() => value({ nowMs: 999 }), /Stale/);
  const short = position('SOL', 10n, 20n);
  short.quote.inputAtomic = 9n;
  assert.throws(() => value({ positions: [short] }), /full-position/);
  assert.throws(() => value({ positions: [position('SOL', 1n, 10n, 11n)] }), /full-position/);
  assert.throws(() => value({ positions: [position('SOL', 1n, 10n, 0n)] }), /full-position/);
  assert.doesNotThrow(() => value({ positions: [{ asset: 'SOL', amountAtomic: 0n }] }));
});

test('malformed monetary values and duplicate holdings cannot create phantom value', () => {
  assert.throws(() => value({ usdcAtomic: 2_000_000 }), /BigInt/);
  assert.throws(() => value({ exitFeeUsdcAtomic: -1n }), /BigInt/);
  assert.throws(() => value({ exitFeeUsdcAtomic: 4_000_000n }), /exceed/);
  assert.throws(() => value({ positions: [position('SOL', 1n, 1n), position('SOL', 1n, 1n)] }), /duplicate/);
});

test('exit fees can erase an apparent gain before any target comparison', () => {
  const liquidation = value({ exitFeeUsdcAtomic: 110_000n });
  assert.equal(liquidation.grossUsdcAtomic, 3_100_000n);
  assert.equal(returns({ currentUsdcAtomic: liquidation.netUsdcAtomic }).profitUsdcAtomic, -10_000n);
});

test('deposits are capital, withdrawals are distributions, neither is trading profit', () => {
  const result = returns({ depositsUsdcAtomic: 2_000_000n, withdrawalsUsdcAtomic: 500_000n, currentUsdcAtomic: 4_500_000n });
  assert.equal(result.contributedUsdcAtomic, 5_000_000n);
  assert.equal(result.profitUsdcAtomic, 0n);
  assert.equal(result.returnBps, 0n);
  assert.equal(result.atFivePercent, false);
});

test('5 and 10 percent boundaries are exact even when display basis points truncate', () => {
  const belowFive = returns({ currentUsdcAtomic: 3_149_999n });
  assert.equal(belowFive.atFivePercent, false);
  assert.equal(returns({ currentUsdcAtomic: 3_150_000n }).atFivePercent, true);
  assert.equal(returns({ currentUsdcAtomic: 3_150_000n }).atTenPercent, false);
  assert.equal(returns({ currentUsdcAtomic: 3_299_999n }).atTenPercent, false);
  assert.equal(returns({ currentUsdcAtomic: 3_300_000n }).atTenPercent, true);
});

test('whole contributed portfolio is the denominator, not the winning position', () => {
  const liquidation = value({ usdcAtomic: 9_000_000n, positions: [position('SOL', 1n, 1_100_000n)], exitFeeUsdcAtomic: 0n });
  const result = returns({ baselineUsdcAtomic: 10_000_000n, currentUsdcAtomic: liquidation.netUsdcAtomic });
  assert.equal(result.returnBps, 100n);
  assert.equal(result.atFivePercent, false);
});

test('loss budget triggers at its exact boundary and negative return remains signed', () => {
  const inputs = { baselineUsdcAtomic: 3_000_000n, depositsUsdcAtomic: 0n, withdrawalsUsdcAtomic: 0n, maxLossUsdcAtomic: 150_000n };
  assert.equal(evaluatePortfolio({ ...inputs, currentUsdcAtomic: 2_850_001n }).action, 'hold');
  const result = evaluatePortfolio({ ...inputs, currentUsdcAtomic: 2_850_000n });
  assert.equal(result.returnBps, -500n);
  assert.equal(result.action, 'stop-loss');
  assert.equal(evaluatePortfolio({ ...inputs, currentUsdcAtomic: 3_150_000n }).action, 'target-5-percent');
  assert.equal(evaluatePortfolio({ ...inputs, currentUsdcAtomic: 3_300_000n }).action, 'target-10-percent');
  assert.throws(() => evaluatePortfolio({ ...inputs, currentUsdcAtomic: 3_000_000n, maxLossUsdcAtomic: 0n }), /positive/);
  assert.throws(() => returns({ baselineUsdcAtomic: 0n }), /positive/);
});
