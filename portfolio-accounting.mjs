// Monetary inputs are BigInt USDC base units (six decimals), never floating prices.
function amount(value, name) {
  if (typeof value !== 'bigint' || value < 0n) throw Error(`Invalid ${name}: expected nonnegative BigInt`);
  return value;
}

export function liquidationValue({ usdcAtomic, positions, exitFeeUsdcAtomic, recoverableRentLamports, rentRefundUsdcAtomic = 0n, rentClosureVerified = false, nowMs, maxQuoteAgeMs }) {
  amount(usdcAtomic, 'USDC balance');
  amount(exitFeeUsdcAtomic, 'exit fee');
  amount(recoverableRentLamports, 'recoverable rent');
  amount(rentRefundUsdcAtomic, 'rent refund');
  if (rentRefundUsdcAtomic > 0n && (rentClosureVerified !== true || recoverableRentLamports === 0n))
    throw Error('Rent refund requires verified account closure');
  if (!Array.isArray(positions) || !Number.isSafeInteger(nowMs) || nowMs < 0 ||
      !Number.isSafeInteger(maxQuoteAgeMs) || maxQuoteAgeMs <= 0) throw Error('Invalid positions or quote clock');
  let grossUsdcAtomic = usdcAtomic;
  const assets = new Set();
  for (const { asset, amountAtomic, quote } of positions) {
    if (typeof asset !== 'string' || !asset || assets.has(asset)) throw Error('Missing or duplicate asset');
    assets.add(asset);
    amount(amountAtomic, `${asset} amount`);
    if (amountAtomic === 0n) continue;
    if (!quote) throw Error(`Missing exit quote for ${asset}`);
    amount(quote.inputAtomic, `${asset} quote input`);
    amount(quote.outUsdcAtomic, `${asset} quote output`);
    amount(quote.minOutUsdcAtomic, `${asset} minimum output`);
    if (quote.inputAtomic !== amountAtomic || quote.minOutUsdcAtomic === 0n ||
        quote.minOutUsdcAtomic > quote.outUsdcAtomic) throw Error(`Invalid full-position exit quote for ${asset}`);
    if (!Number.isSafeInteger(quote.observedAtMs) || quote.observedAtMs < 0 ||
        quote.observedAtMs > nowMs || nowMs - quote.observedAtMs > maxQuoteAgeMs)
      throw Error(`Stale or invalid exit quote for ${asset}`);
    grossUsdcAtomic += quote.minOutUsdcAtomic;
  }
  if (exitFeeUsdcAtomic > grossUsdcAtomic + rentRefundUsdcAtomic) throw Error('Exit fees exceed liquidation proceeds');
  return { grossUsdcAtomic, exitFeeUsdcAtomic, netUsdcAtomic: grossUsdcAtomic + rentRefundUsdcAtomic - exitFeeUsdcAtomic, recoverableRentLamports, rentRefundUsdcAtomic };
}

export function portfolioReturn({ baselineUsdcAtomic, depositsUsdcAtomic, withdrawalsUsdcAtomic, currentUsdcAtomic }) {
  amount(baselineUsdcAtomic, 'baseline');
  amount(depositsUsdcAtomic, 'deposits');
  amount(withdrawalsUsdcAtomic, 'withdrawals');
  amount(currentUsdcAtomic, 'current value');
  const contributedUsdcAtomic = baselineUsdcAtomic + depositsUsdcAtomic;
  if (contributedUsdcAtomic === 0n) throw Error('Return requires positive contributed capital');
  const profitUsdcAtomic = currentUsdcAtomic + withdrawalsUsdcAtomic - contributedUsdcAtomic;
  return {
    contributedUsdcAtomic,
    profitUsdcAtomic,
    // Display only: BigInt division rounds toward zero; gates below use exact ratios.
    returnBps: profitUsdcAtomic * 10_000n / contributedUsdcAtomic,
    atFivePercent: profitUsdcAtomic * 10_000n >= contributedUsdcAtomic * 500n,
    atTenPercent: profitUsdcAtomic * 10_000n >= contributedUsdcAtomic * 1_000n,
  };
}

export function evaluatePortfolio({ maxLossUsdcAtomic, ...values }) {
  amount(maxLossUsdcAtomic, 'loss budget');
  if (maxLossUsdcAtomic === 0n) throw Error('Loss budget must be positive');
  const result = portfolioReturn(values);
  const stopLossReached = result.profitUsdcAtomic <= -maxLossUsdcAtomic;
  return { ...result, stopLossReached, action: stopLossReached ? 'stop-loss' : result.atTenPercent ? 'target-10-percent' : result.atFivePercent ? 'target-5-percent' : 'hold' };
}
