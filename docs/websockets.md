# HTTP polling and WebSocket observation

The CLI adds bounded account streaming and a separate, explicitly authorized 1 USDC -> native SOL demonstration. The original portfolio executor and closed run keep their existing policy and records.

```sh
helius-bot watch --seconds 60
helius-bot watch --account YOUR_TOKEN_ACCOUNT --seconds 60
helius-bot compare --seconds 120 --poll-ms 2000 --disconnect-after 40 --output comparison.json
```

`watch` defaults to the configured wallet's native SOL account. It watches one account, not every token account owned by a wallet. Pass a token-account address to observe that account. `compare` defaults to Solana's Clock sysvar, which changes without spending funds. Both use `confirmed` commitment and standard `accountSubscribe`; neither loads a signing key. The comparison's HTTP reader waits the requested interval after each response. They stop after the requested duration (1-600 seconds) or Ctrl-C.

The stream waits for subscription acknowledgements, uses protocol ping/pong heartbeats, reconnects with backoff, and restores subscriptions. An HTTP snapshot after each successful connection reconciles current state. It does not replay missed intermediate events. Recovering complete transaction history would require a separate bounded history/backfill pipeline.

`--output` creates a new private JSON file and refuses to overwrite an existing path. Reports retain received observations, connection events, request counts and account-state hashes. Equal hashes match account contents even when HTTP context slots differ. Positive `httpMinusWebsocketMs` means the WebSocket observation arrived first; negative means HTTP arrived first. Unmatched states are reported separately. This is a one-client observation experiment, not an inclusion-latency or provider benchmark. High-frequency streams produce more observations than sparse polling and incur metered data usage.

## One real swap

```sh
helius-bot stream-trade --live
helius-bot stream-status
```

`stream-trade --live` explicitly authorizes exactly one 1 USDC -> native SOL attempt for this setup. It needs a local signing wallet, at least 1 USDC and 0.003 SOL before preparation. The existing pilot guard checks the route, exact USDC debit, minimum SOL receipt, 0.5% slippage, 1% price-impact ceiling and 60,000-lamport network-fee cap. It uses the pilot's Kipseli route restriction. No extra tip is authorized. This is separate from `authorize` and does not run the portfolio strategy.

The command acquires the shared execution lock. It signs the checked transaction, acknowledges confirmed/finalized signature subscriptions and SOL/USDC account subscriptions, then checks quote age and blockhash lifetime again. It saves the signed attempt exclusively to `stream-swap-attempt.json` and flushes it before submitting. HTTP status checks and the WebSocket subscriptions observe that same signature. Finalized metadata and wallet-effect reconciliation establish the fill, not a WebSocket notification alone.

One completed or unresolved streaming attempt blocks another `stream-trade` in that setup. `stream-status` observes its original signature and reconciles finalization; it never sends or signs a replacement. A timeout is not evidence of failure. The explicit `stream-trade --live --retry-expired` path permits a replacement only after finalized expiry, an invalid original blockhash, an absent finalized transaction, and exactly unchanged USDC and SOL balances. It archives the original attempt and evidence before preparing again. Successful, failed-on-chain, ambiguous, or balance-changing attempts cannot use this path. Do not delete records or create another setup to bypass this stop. A process crash can leave a lock requiring investigation.

Private signed bytes stay in the setup directory. `stream-swap-evidence.json` contains public observations and a receipt, without the wallet key, API key or signed wire bytes. This command buys SOL and leaves it in the wallet. It does not sell it later, prove profit, or react to the stream by trading automatically. The original monitor does not monitor this separate test.
