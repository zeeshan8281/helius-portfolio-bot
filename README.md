# A tiny Solana portfolio experiment with Helius

A mainnet experiment targeting a 5–10% portfolio return across native SOL, Wormhole WETH, Sunrise HYPE, and OmniBridge ZEC. Jupiter Swap V2 supplies swap instructions; Helius supplies account data, blockhashes, simulation, priority-fee estimates, submission, and finalized settlement reads. The target is an experiment, not a promised result or a proven trading edge.

**Current evidence:** the earlier 1 USDC → SOL pilot and three 0.65 USDC portfolio entries finalized and reconciled. Actual full-position exit simulations passed for all four assets, including token-account deposit refunds. No live sale or profitable multiasset result has been established. Read [the current run and receipts](docs/run-status.md), [the pilot](docs/pilot.md), [asset identity research](docs/asset-research.md), and [accounting rules](docs/accounting.md).

The proposed allocation keeps the existing SOL exposure and buys 0.65 USDC each of ETH, HYPE, and ZEC, with a lifetime entry budget of 1.95 USDC. A token name alone is never an allowlist entry. These bridged representations carry bridge, issuer, liquidity, and redemption risks; their exact mints and pinned authorities are in `assets.json`.

## Runtime and commands

Use Node.js 24 or newer. Dependencies are pinned in package-lock.json.

```sh
npm ci
npm test
npm run balances
npm run simulate
npm run execute
npm run status
node portfolio-prepare.mjs ETH
node portfolio-prepare.mjs HYPE
node portfolio-prepare.mjs ZEC
node portfolio-mark.mjs
node portfolio-monitor.mjs
```

`portfolio-prepare` and `portfolio-mark` are read-only. They never load the wallet key or submit a transaction. A successful simulation is not a fill. Quotes and mark-to-market changes are not realized profits.

`portfolio-monitor` is a real-money protective exit process for the approved run. It samples the portfolio about every30seconds after each quote cycle, latches a stop at the approved loss trigger, estimated profit target, or deadline, and invokes full-position exits. The persistent stop prevents reentry even if prices later recover. It needs this computer and network to remain available; its triggers cannot guarantee a particular fill or maximum loss. An exit can proceed when a portfolio-wide mark is unavailable, but each actual trade still needs its own quote, account checks, simulation and settlement reconciliation.

`node portfolio-run.mjs execute ETH entry` is a real-money command. It refuses to sign without a separately recorded risk/time authorization bound to this wallet and the immutable experiment baseline. The live run uses the user's approved10%loss trigger and24-hour limit; no approved authorization file is supplied in this repository. Protective full-position exits may continue after the entry deadline. `node portfolio-run.mjs recover` observes the original persisted signature; it does not invent a replacement signature.

The multiasset path verifies the official on-chain Jupiter instruction layout and quoted amounts, mints, accounts, fees, and slippage. Lookup-table indexes are checked against actual active on-chain tables. Simulations use a context at least as recent as the wallet snapshot. Entries must leave at least 0.003 SOL for gas. A priority recommendation above the 50,000-lamport budget is capped, then the full transaction is simulated again; that lower bid can reduce its chance of landing. Total network fees remain capped at 60,000 lamports.

Signed intents reserve entry budget before submission. The journal is flushed to disk before sending, and the one-shot and portfolio paths share an exclusive execution lock. An ambiguous send remains unresolved until chain evidence proves success, failure, or expiry without changed balances. A later external deposit can prevent exact reconciliation and requires investigation; it is never silently counted as profit. Never delete a journal or lock to repeat a trade.

The earlier `execute` command is a separate one-shot pilot, bound to exactly 1 USDC input. It uses the Kipseli route that passed its native-SOL receipt checks. Its completed attempt prevents another pilot trade. It is not the multiasset executor, an LLM agent, or a demonstrated profitable strategy.

This research copy is bound to its dedicated wallet. Do not fund the article's example address. Adapting it requires reviewing every wallet-bound policy, baseline, authorization, asset registry, and recovery assumption. The wallet key, API configuration, and transaction journal are outside the source tree at ~/.local/share/helius-trading-bot/ (directory mode 700, sensitive files mode 600):

- bot-wallet.json: 64-byte Solana secret-key array for the selected OWNER. Never publish it.
- config.json: `{ "heliusApiKey": "YOUR_KEY", "jupiterApiKey": "OPTIONAL_JUPITER_KEY" }`.
- one-usdc-attempt.json: signed bytes, signature, quote, original blockhash, and expiry. Do not delete it to repeat a trade.

The funded test wallet already has a successful attempt. Normal execution refuses a second attempt. The explicit `node bot.mjs execute --retry-expired` path permits replacement only when finalized chain evidence proves the old blockhash expired, its transaction is absent, and both wallet balances are unchanged. A live execution error, missing evidence, successful trade, or changed wallet stops that path. A stale execution.lock after a crash also stops execution; investigate before any recovery.

Preparation failures before signing do not spend funds. While a signed attempt is unresolved, the executor rebroadcasts only the same bytes while their original blockhash is valid. It never creates an automatic replacement. The receipt is complete only after finalized transaction metadata confirms exactly 1 USDC debit, the minimum SOL receipt, and actual fee within policy.

## Actual validation, 28 October 2026

- Live Helius RPC and Jupiter V2 quote/build, unsigned simulation, fee estimate, and final wallet-effect simulation.
- One submission expired unobserved and left finalized balances unchanged. The guarded retry archived it.
- One 1 USDC swap finalized and reconciled: signature `3msvcbCPakKnZ3kpMTQdXDotoHR6UWNraTjjopo4kQNncbGNcwNTw236aYAH7L6TtWhH9yJFhxArF6AYcNsXPLmQ`.
- Received 0.009880691 SOL before a 0.000031532 SOL network fee; wallet ended with 2 USDC and 0.014849159 SOL.
- Unit policy checks and both post-success refusal paths passed. No additional trade was made during these refusal checks.

The run used Node 24.19.0 and @solana/web3.js 3.1.1. A library-loading stall in the Documents directory was avoided by running an identical source copy with dependencies in the local cache; source hashes were checked. No claims about production readiness, profit, trading strategy performance, Sender, webhook delivery, streaming, or latency are validated by this small test.

The new experiment must record a fresh, timestamped starting portfolio before any allocation. The earlier pilot remains a separate receipt: its original funding-time SOL price was not captured, so it cannot establish an exact historical USD return. Account deposits, gas reserves, fee estimates, external capital flows, paper gains, and finalized sale proceeds must remain distinct in the article.

See the separate public receipt and article draft. No keys, API credentials, signed transaction journals, or node_modules belong in the shareable package.
