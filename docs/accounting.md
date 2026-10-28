# Portfolio accounting contract

The new `helius-trading-bot/portfolio-accounting.mjs` is pure arithmetic. It makes no requests, reads no files or keys, and cannot send trades. It uses BigInt for every token or monetary quantity. USDC amounts have six decimals; SOL and account-rent quantities are lamports. No token's ticker implies that a mint is genuine or redeemable.

## Inputs and valuation

`liquidationValue` receives the free USDC balance and all non-USDC holdings, aggregated by unique asset identifier (use mint addresses in an adapter). Each nonzero holding needs a full-size exact-input exit quote to canonical USDC, with expected and minimum USDC outputs. A missing, stale, future-dated, partial-size, or invalid quote throws. The minimum output is used, rather than multiplying a tiny position's spot price by a larger holding. The caller supplies a current clock and a maximum quote age; the function never creates its own timing assumptions.

`grossUsdcAtomic` is free USDC plus quoted minimum sell proceeds. `netUsdcAtomic` subtracts an explicit estimate of all exit network fees, converted conservatively to USDC base units, and adds only verified rent refunds. Trading fees and price impact already embedded in the minimum quote output must not be subtracted a second time. Entry fees already reduce the observed holdings and must not be charged again. Exit fees must cover every proposed exit, including failed-attempt reserves if the budget requires them.

The adapter must verify canonical output mint, route, quote provenance and freshness, fee conversion, actual spendable balance, reserved SOL, setup/closure costs, and a full exit simulation. A full-SOL quote alone is not executable if SOL must be reserved to pay that exit's network fee. The pure calculator cannot discover omitted holdings, validate RPC observations, or determine if a route can be executed. Quote minima are an estimate for an unsigned exit, not guaranteed realized proceeds.

## Rent is an account deposit

`recoverableRentLamports` is reported separately. It is not spendable SOL, trading revenue, or necessarily a permanent expense. Do not hardcode the historic 2,039,280-lamport ATA rent: the parent's current live observation was 1,488,440 lamports for 165 bytes. Query the live rent requirement and account balance for each account.

An optional `rentRefundUsdcAtomic` is included in exit proceeds only when `rentClosureVerified` is exactly true and recoverable rent exists. That flag is a caller assertion: set it only after the actual proposed exit plus account-closure simulation proves the correct owner's refund and an exact conservative SOL-to-USDC valuation. Include closure fees in the exit fee estimate, and never count a refund both in a SOL quote and in the separate refund field. The default is zero. If assets cannot be emptied/closed or closure is unverified, the rent remains an illiquid deposit. A liquid-value decline caused by moving SOL into an account deposit is **not evidence of a realized trading loss**. Report the rent movement separately and keep baseline/end-state rent treatment consistent; otherwise an economic P&L claim remains incomplete. Existing ATA deposits held unchanged before and after cancel under the same treatment.

## Capital flows and thresholds

`portfolioReturn` calculates:

```
contributed capital = baseline value + additional deposits
profit = current net value + withdrawals - contributed capital
simple return = profit / contributed capital
```

Deposits and withdrawals must be valued in USDC at their actual event time and recorded independently of bot trades. Their transfers are not profit. This is a contributed-capital simple return, not a time-weighted or annualized performance measure. Additional deposits increase the denominator. A return on only the winning asset is not the portfolio return.

Displayed basis points round toward zero because BigInt division does. Both 5% and 10% target flags use exact cross multiplication, so a truncation boundary never triggers a target early. `evaluatePortfolio` applies an explicit positive USDC loss budget and reports a threshold state; it does not execute orders. It cannot guarantee a stop price, availability, liquidity, or profitability.

## Baselines and evidence

The public pilot receipt proves a 1 USDC spend, 9,880,691 lamports received before 31,532 lamports network fee, and ending holdings of 2 USDC plus 14,849,159 lamports. It does not prove the historic USDC value of the user's original 3 USDC plus 0.005 SOL funding. Do not infer that missing SOL price from the later trade or silently reset it to report a profit.

For the newly requested experiment, create a timestamped baseline now from independently verified starting holdings (expected from the public pilot: 2 USDC plus 14,849,159 lamports), fresh executable full-size exit quotes, and matching fee/rent treatment. Preserve the pilot as a separate historical result and record that the new experiment starts after it. The target for the new experiment and the return since original funding are different claims; the second remains unknown without historic flow valuation.

An executable liquidation estimate is a paper estimate. A realized 5–10% result requires finalized exit transactions, actual proceeds and fees, reconciled balances, all capital flows, and consistent rent treatment across the full portfolio. This module's fixture tests validate arithmetic, not live market access, token safety, execution, or return performance.

## Tests

Run `node --test portfolio-accounting.test.mjs` from `helius-trading-bot`. Coverage includes missing/stale/partial quotes, exact monetary types, duplicate holdings, fees erasing apparent gains, deposits and withdrawals, 5%/10% boundaries, a whole-portfolio denominator, signed negative returns, exact loss-budget thresholds, and locked versus verified account-rent refunds. No live funds are needed or used.
