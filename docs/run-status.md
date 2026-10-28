# Completed live experiment

The run closed because its time limit expired. Neither the 10% gain nor 10% loss trigger fired. The final marked portfolio return was approximately −0.97%; this is a loss, not a successful profit strategy.

| Event | UTC on 28 October 2026 |
|---|---|
| Original experiment baseline |06:10:29.672|
| User changed the remaining window to 30 minutes |06:27:43.000|
| Planned start of closing |06:56:13.000|
| Monitor recorded all risk positions closed |06:57:38.638|
| Requested result deadline |06:57:43.000|
| Independent finalized transaction and wallet verification |06:58:26.765|

The amended window lasted 29 minutes 55.638 seconds through closure. The original P&L window lasted 47 minutes 8.966 seconds. The original baseline was preserved when the user changed the target and deadline. The pre-deadline completion timestamp comes from the live monitor record; later independent reads verified all seven transactions at finalized commitment. Block times alone do not establish when finality was observed.

| Portfolio observation | Value |
|---|---:|
| Starting bid mark |3.664699USDC|
| Ending actual USDC |3.169640USDC|
| Ending native SOL |0.003025003SOL|
| Remaining USDC-account deposit |0.001488440SOL|
| Ending bid mark |3.629242USDC|
| Marked change |−0.035457USDC (−0.9675283%)|
| Conservative minimum-mark return |−1.0302074%|
| Actual network fees across seven transactions |0.000265083SOL|
| Actual refunds from the three closed token accounts |0.004465320SOL|

The ending NAV includes quote values for residual SOL and its account deposit; it is not an all-USDC realized return. Entry and exit fees already reduced the actual wallet, so the marked return does not subtract them again. The return since original wallet funding remains unknown because the earlier funding-time SOL valuation was not captured.

See evidence/portfolio-result.json for all seven exact transaction signatures, actual amounts, fees, refunds, final holdings, and valuation limits. All entries and full exits finalized and reconciled. A separate read-only script fetched every transaction again and checked the actual input, output, native movement, fee, and account refund.

Two closing preparations failed the associated-account policy and were rejected before signing. Fresh preparations later passed. A quote timed out during monitoring. The monitor tried another asset only after checking that all original intents remained safely resolved. No failed on-chain trade or duplicate signature replacement was used.

The monitor and quote recorder have exited. The keep-awake process ended with the monitor. The authorization has expired, and a persistent stop prevents new entries. No further trade should run under these limits.

Validation gaps: no live process-crash injection, stale-lock recovery test, or bridge redemption. These targeted checks and a single small mainnet experiment are not a full security audit or evidence of a repeatable strategy advantage. The 54 unit tests passed. The user subsequently authorized publishing the code and creating a Hashnode draft that reports the actual loss. The closed run remains stopped.
