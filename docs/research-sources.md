# Research sources and claim boundaries

AS_OF: 2026-10-28. These are the primary sources behind this experiment's asset and execution choices. Undated documentation was checked as of that date; it is not assigned an invented publication date. Asset-identity findings are in `asset-research.md`. Live quotes and unsigned simulations are observations, not evidence of profitability.

| ID | Source | Type / access | What it supports | Limit |
|---|---|---|---|---|
| 1 | [Solana: Sync Native](https://solana.com/docs/tokens/basics/sync-native) | Official / public | Native SOL versus wrapped SOL account behavior | Does not prove this bot's cleanup |
| 2 | [Helius: simulateTransaction](https://www.helius.dev/docs/api-reference/rpc/http/simulatetransaction) | Official / public | RPC simulation and account effects | A simulation is not submission or settlement |
| 3 | [Solana: simulateTransaction](https://solana.com/docs/rpc/http/simulatetransaction) | Official / public | Unsigned simulation and minimum context slot | Current chain state may change before execution |
| 4 | [Helius: Priority Fee API](https://www.helius.dev/docs/priority-fee-api) | Official / public | Transaction-scoped fee recommendations | Recommendations do not guarantee inclusion |
| 5 | [Jupiter: Swap V2](https://developers.jup.ag/docs/swap) | Official / public | Current swap API family | Does not attest to a returned instruction's bounds |
| 6 | [Jupiter: program authority derivation](https://github.com/jup-ag/jupiter-amm-implementation/blob/main/jupiter/src/lib.rs) | Official code / public | Shared-account PDA seed and authority range | Repository IDL may lag the live program |
| 7 | [Wormhole SDK token registry, pinned commit](https://github.com/wormhole-foundation/wormhole-sdk-ts/blob/479df45f0a11684a13174189851c00e19b536a4a/core/base/src/constants/tokens/mainnet.ts) | Official code / public | Exact Solana WETH mint and decimals | Registry identity is not backing or redemption proof |
| 8 | [Sunrise: listed assets](https://docs.sunrise.xyz/resources/listed-assets.md) | Official / public | Exact HYPE mint and documented authority | Does not prove current exit liquidity |
| 9 | [Sunrise: infrastructure and security](https://docs.sunrise.xyz/concepts/infrastructure-and-security.md) | Official / public | HYPE infrastructure and trust assumptions | No independent security audit performed here |
| 10 | [Sunrise: withdrawal from Solana](https://docs.sunrise.xyz/guides/withdraw-from-solana.md) | Official / public | Documented redemption path | No bridge redemption was executed |
| 11 | [NEAR: OmniBridge overview](https://docs.near.org/chain-abstraction/omnibridge/overview) | Official / public | Bridge architecture | Architecture documentation alone does not identify a token |
| 12 | [NEAR: how OmniBridge works](https://docs.near.org/chain-abstraction/omnibridge/how-it-works) | Official / public | Cross-chain representation model | Does not establish reserves or instant redemption |
| 13 | [OmniBridge contract source](https://github.com/Near-One/omni-bridge/blob/main/near/omni-bridge/src/lib.rs) | Official code / public | Registry methods independently queried for ZEC | Live registry responses and block IDs remain separate evidence |
| 14 | [Wormhole: wrapped token transfers](https://docs.wormhole.com/products/token-transfers/wrapped-token-transfers/overview/) | Official / public | Wrapped-asset trust model | Wrapped ETH is not native Ethereum ETH |

Approved set: 14 primary sources across seven domains; largest domain share is 3/14. Authority is high for API schemas and each issuer's own claimed mint identity, lower for claims about economic safety. No return claim is supported by this registry.

Additional public-chain evidence: Jupiter's live Anchor IDL was fetched at finalized slot462262056 from `C88XWfp26heEmDkmfSzeXP7Fd7GQJ2j9dDTUsyiZbUTa`, owned by the Jupiter program. The decoder pins its exact instruction schemas. The historical repository IDL was insufficient for newer V2 layouts, so it was not substituted for the live layout. This is a schema check, not an audit of the program's implementation or upgrade authority.

The Sunrise ZEC announcement was inaccessible directly on X. Its authored text was read through a public mirror and remains supplementary. The stronger identity check was a live, bidirectional query of the official NEAR bridge registry, with exact block IDs recorded in `asset-research.md`. No assertion of native or shielded ZEC custody follows from that result.

Counter-review found and prompted fixes for opaque Jupiter instruction terms, unchecked lookup-table indexes, unexplained native credits, inconsistent snapshot slots, pending-intent budget reservations, missing entry risk gates, and signing-time expiry checks. These targeted reviews and tests are not a full security audit. All three portfolio entries and four full exits have since finalized and reconciled against actual metadata. The run lost about 0.97% on its marked value. Profit was not established; live crash recovery remains unverified. The user subsequently authorized an honest article draft reporting this result.
