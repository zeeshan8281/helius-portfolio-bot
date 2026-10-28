# Helius one-shot trading executor

A small USDC → native SOL executor used for the companion article. Jupiter V2 supplies swap instructions; Helius supplies balances, blockhash, simulation, priority fees, submission, and settlement reads.

## Runtime and commands

Use Node.js 24 or newer. Dependencies are pinned in package-lock.json.

```sh
npm ci
npm test
npm run balances
npm run simulate
npm run execute
npm run status
```

`execute` sends real mainnet funds. This demonstration is bound to the wallet address in policy.mjs, exactly 1 USDC input, 50 bps slippage, at most 1% absolute price impact, 50,000 lamports priority fee, and 60,000 lamports network fee. It uses the Kipseli route because that route passed the conservative native-SOL receipt checks. This is an execution demonstration; it contains no automated price strategy or LLM integration.

Before adapting the code, replace OWNER in policy.mjs with your own wallet address. Do not fund the article's example address. The wallet must have USDC plus a SOL reserve. The wallet key, API configuration, and transaction journal are intentionally outside the source tree at ~/.local/share/helius-trading-bot/ (directory mode 700, sensitive files mode 600):

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

See the separate public receipt and article draft. No keys, API credentials, signed transaction journals, or node_modules belong in the shareable package.
