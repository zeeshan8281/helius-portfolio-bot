# From RPC polling to WebSockets: watching a real Solana trade with Helius

The first version of my Solana bot kept asking Helius the same question: has the transaction landed yet?

It checked transaction status every two seconds. The portfolio monitor waited 30 seconds after each quote cycle before checking again. That was enough to run a small experiment, but I wanted to understand what changes when the application listens for updates instead.

So I added WebSocket subscriptions to the same project and tested them alongside HTTP polling. The test included a real 1 USDC swap into native SOL, plus a separate account-streaming experiment that could run without spending money. I also deliberately disconnected the stream to check what happened next.

The measurements need a narrower interpretation than "WebSockets are faster." Both paths can observe the same chain state at different times, and a subscription can miss data while disconnected. The application still has to decide what counts as evidence.

## Contents

- [What the old bot actually did](#what-the-old-bot-actually-did)
- [What changes with a subscription](#what-changes-with-a-subscription)
- [The implementation](#the-implementation)
- [Watching one real trade](#watching-one-real-trade)
- [A separate test for account updates](#a-separate-test-for-account-updates)
- [What happened when the connection dropped](#what-happened-when-the-connection-dropped)
- [Where HTTP still belongs](#where-http-still-belongs)
- [Run the same commands](#run-the-same-commands)
- [What this experiment establishes](#what-this-experiment-establishes)

<a id="what-the-old-bot-actually-did" name="what-the-old-bot-actually-did"></a>

## What the old bot actually did

The existing bot used HTTP JSON-RPC for account reads, simulation, submission, and settlement. After sending a signed transaction, it called `getSignatureStatuses` in a loop. A successful submission response meant the node accepted the request; the bot still needed evidence that the transaction executed.

The loop was roughly:

```js
while (!finished) {
  const statuses = await rpc('getSignatureStatuses', [
    [signature],
    { searchTransactionHistory: true },
  ]);
  inspect(statuses.value[0]);
  await delay(2000);
}
```

The timer adds a wait between checks. Each request also takes time, so the observed interval is longer than exactly two seconds. A status change just after one response may wait almost the whole interval before the next request sees it.

Polling is straightforward. It also works after a process restarts, which matters when a submitted transaction has an uncertain outcome. The original journal already saved the signature and signed bytes before submission. I kept that ordering.

<a id="what-changes-with-a-subscription" name="what-changes-with-a-subscription"></a>

## What changes with a subscription

A WebSocket connection stays open. The client sends a subscription request, receives a subscription ID, and then receives notifications associated with that ID. This is still part of the JSON-RPC interface; switching transport does not make the transaction itself execute sooner. [Helius WebSocket quickstart](https://www.helius.dev/docs/rpc/websocket/quickstart)

For a known transaction, `signatureSubscribe` lets the client request a notification at a chosen commitment. A confirmed notification and a finalized notification answer different questions, so I created separate subscriptions for each. I compared them with HTTP observations at the same commitment rather than calling a confirmed event faster than a finalized response. [Solana signature subscriptions](https://solana.com/docs/rpc/websocket/signaturesubscribe)

For balances and account data, `accountSubscribe` reports changes to a particular account. A wallet's native SOL account and its USDC token account are separate addresses. Watching the wallet account alone does not watch the USDC balance. [Solana account subscriptions](https://solana.com/docs/rpc/websocket/accountsubscribe)

![HTTP requests versus WebSocket notifications, with HTTP reconciliation retained](https://raw.githubusercontent.com/zeeshan8281/helius-portfolio-bot/main/docs/images/websocket-flow.png)

*The subscription supplies observations. The finalized transaction read supplies the receipt.*

<a id="the-implementation" name="the-implementation"></a>

## The implementation

I added three commands to the npm package:

| Command | Purpose | Signs a transaction? |
| --- | --- | --- |
| `watch` | Observe changes to one selected account | No |
| `compare` | Record HTTP and WebSocket observations of the same account | No |
| `stream-trade --live` | Submit one guarded 1 USDC swap and observe its signature through both paths | Yes |

The streaming module uses the `ws` package, which was already present in the dependency tree and is now an explicit pinned dependency. It checks subscription acknowledgements, tracks connection generations, sends protocol ping frames, and waits for pong responses. Failed connections reconnect with backoff and restore their subscriptions. The client records a rejected subscription as an error instead of treating an open socket as success.

Here is the subscription shape used for one account:

```js
const request = {
  jsonrpc: '2.0',
  id: 1,
  method: 'accountSubscribe',
  params: [
    accountAddress,
    { commitment: 'confirmed', encoding: 'base64' },
  ],
};

ws.send(JSON.stringify(request));
```

An acknowledgement has `result: SUBSCRIPTION_ID`. Later notifications carry that ID in `params.subscription`. Matching those IDs prevents a message from one subscription being confused with another.

The account observer is deliberately scoped to one address. By default, `watch` uses the configured wallet's native SOL account. A user can pass a token-account address with `--account`. It is not a complete wallet indexer.

Helius also offers `transactionSubscribe`, with account filters and token-account expansion. That is a sensible extension for a wallet activity feed, but it requires an eligible paid plan. This implementation uses standard subscriptions and does not claim to have tested the richer method. [Helius methods and plan access](https://www.helius.dev/docs/rpc/websocket)

<a id="watching-one-real-trade" name="watching-one-real-trade"></a>

## Watching one real trade

The live test explicitly authorized one 1 USDC purchase of native SOL. It used a separate attempt record, preserving the earlier closed portfolio experiment. The original experiment's approximately 0.97% loss remains its own result.

The trade reused the existing pilot's preparation checks: exact USDC input, the expected mints and Jupiter program, a restricted Kipseli route, a simulated minimum SOL receipt, and a capped network fee. Slippage stayed at 0.5%; the price-impact ceiling stayed at 1%. Preparation can reject a route before submission.

The order matters:

1. Build and simulate the proposed swap.
2. Sign the checked transaction locally to obtain its signature.
3. Subscribe to that signature at confirmed and finalized commitment, plus the wallet's SOL and USDC accounts.
4. Wait for all subscription acknowledgements.
5. Check quote age and blockhash lifetime again.
6. Save the signed attempt and flush it to disk.
7. Submit the transaction while HTTP and WebSocket observers track the same signature.
8. Fetch finalized metadata and reconcile the actual debit, output, and fee.

Waiting for subscriptions after preparing can make a quote stale. The second freshness check rejects that case rather than submitting an old quote just to complete the demonstration.

The first submitted signature expired without landing. Before replacing it, the executor checked finalized expiry, confirmed that the original blockhash was invalid, found no finalized transaction, and verified exactly unchanged SOL and USDC balances. It archived that attempt and its evidence. The replacement reused the same 1 USDC budget; its one rebroadcast sent identical signed bytes with the same signature.

The replacement finalized successfully:

| Receipt field | Measured result |
| --- | --- |
| USDC spent | 1.000000 USDC |
| SOL received before network fee | 0.009729585 SOL |
| Network fee | 0.000032094 SOL |
| Wallet SOL after the swap | 0.012722494 SOL |
| Remaining USDC | 2.169640 USDC |
| Finalized slot | 462451503 |
| Finalized notification advantage over the HTTP poll | 1,663.875 ms |

[Inspect the actual transaction](https://solscan.io/tx/46HMFNkNW5xUKVTAWyzaAu2FZjco4nNz4LQApc3N1VQM6sQADx3JF3arFCdHqH2KmDjbmxv34t7SqbZTQCB3LHUD). All four WebSocket notifications, confirmed signature, finalized signature, SOL account and USDC account, reported the receipt's slot. A separate verification re-fetched finalized metadata, status and wallet balances and checked the exact amounts again.

The HTTP loop went from unknown directly to finalized. It did not observe a separate confirmed state, so the report leaves that comparison empty. I do not invent a confirmed polling timestamp to fill the table.

The arrival-time comparison uses the first observation from each transport at matching commitment. A positive `HTTP minus WebSocket` number means the WebSocket notification arrived first. A negative number means the HTTP response arrived first. The two-second polling interval is an application setting, so this measures the behavior of these observers as configured, not a universal transport advantage.

![Measured arrival times for the same real transaction](https://raw.githubusercontent.com/zeeshan8281/helius-portfolio-bot/main/docs/images/websocket-trade-timeline.png)

*The confirmed and finalized WebSocket observations arrived close together in this run. That observation does not establish a general Solana finality duration.*

The trade buys SOL and leaves it in the wallet. I did not run an additional sale or count this as a profit experiment. Network fees are separate from the 1 USDC swap input.

<a id="a-separate-test-for-account-updates" name="a-separate-test-for-account-updates"></a>

## A separate test for account updates

One transaction is too small a sample to say much about account-stream coverage. I also watched Solana's Clock sysvar through both transports. Its account data changes as the chain progresses, which provides observable updates without manufacturing activity or sending more transactions.

Both readers used the same account, Helius mainnet endpoint family, and `confirmed` commitment. The HTTP reader requested `getAccountInfo`, waited two seconds after the response, and requested again. The WebSocket reader subscribed to `accountSubscribe`.

To match observations, the code hashes the account contents:

```js
createHash('sha256')
  .update(JSON.stringify([
    value.lamports,
    value.owner,
    value.executable,
    value.data,
  ]))
  .digest('hex');
```

It excludes the response's context slot from the hash. An HTTP response may have a later context while still returning identical account contents. Comparing context slots alone would misclassify that state.

This produces a comparison of unique observed states. It does not reconstruct every account write or establish that identical recurring states belong to the same event. The changing Clock data makes the chosen test easier to interpret than a balance that repeatedly returns to the same value.

The 120-second run recorded:

| Observation | Result |
| --- | --- |
| Unique WebSocket account states | 547 |
| Unique HTTP account states | 57 |
| States observed by both readers | 55 |
| WebSocket-only states | 492 |
| HTTP-only states | 2 |
| Matched states where WebSocket arrived first | 24 |
| Matched states where HTTP arrived first | 31 |
| Median HTTP minus WebSocket arrival time | -11.482 ms |
| P95 HTTP minus WebSocket arrival time | 127.630 ms |
| HTTP requests, including reconnect snapshots | 59 |
| HTTP errors | 0 |
| WebSocket connections / reconnects | 2 / 1 |

For the matched Clock states, HTTP was first more often. The socket's larger difference was coverage: it delivered 547 unique states while the sparse HTTP reader observed 57. This is a comparison with a deliberately spaced polling loop; it does not establish that a carefully tuned HTTP client would perform the same way.

[Raw comparison report](https://github.com/zeeshan8281/helius-portfolio-bot/blob/main/evidence/websocket-account-comparison-120s.json) · [Earlier smoke test](https://github.com/zeeshan8281/helius-portfolio-bot/blob/main/evidence/websocket-smoke-comparison.json)

![Unique account states and matched arrival results in the 120-second test](https://raw.githubusercontent.com/zeeshan8281/helius-portfolio-bot/main/docs/images/websocket-account-comparison.png)

Unmatched states deserve their own count. If the socket observes intermediate states between polls, those states cannot contribute a matched arrival-time difference. Ignoring them would hide the clearest behavioral difference between the two readers.

The earlier 15-second smoke test also stays in the evidence. It recorded 59 unique WebSocket states and seven HTTP states, with five matched states. HTTP arrived first for three of those five matches. I have kept that result rather than selecting only observations that favor the socket.

<a id="what-happened-when-the-connection-dropped" name="what-happened-when-the-connection-dropped"></a>

## What happened when the connection dropped

The comparison command can deliberately terminate its own connection at a chosen point. This tests a real reconnect against Helius. It does not simulate every possible network failure or a provider outage.

The client opens another connection, resends its subscriptions, and waits for acknowledgements. After each ready event, it fetches a fresh HTTP account snapshot. The snapshot tells it what the account looks like now.

It cannot tell it every change that happened during the gap.

That limit matters. I call this current-state reconciliation, not complete event recovery. A transaction-history backfill pipeline would need its own persisted cursor, pagination, and deduplication. The current package does not implement that pipeline. Helius's documentation also describes explicit reconnection and subscription restoration as application responsibilities. [Connection handling](https://www.helius.dev/docs/rpc/websocket#how-to-implement-reconnection-logic)

The live comparison records connection events and the number of reconciliation snapshots, so the reconnect claim can be checked against the saved report.

<a id="where-http-still-belongs" name="where-http-still-belongs"></a>

## Where HTTP still belongs

The WebSocket notification wakes the application. HTTP still supplies the initial snapshot and the finalized transaction metadata used for settlement. It also observes the original signature if the stream drops or the process restarts.

For the trading bot, portfolio valuation still needs executable quotes. A token's quantity can remain unchanged while its value falls. Subscribing to my wallet account would not detect that market movement, and an account notification is not a Jupiter exit quote.

The monitor's independent deadline checks also remain necessary. A quiet stream does not mean the authorized trading window is still open.

| Job | Interface used here |
| --- | --- |
| Initial balance/account state | HTTP RPC |
| Account updates | WebSocket `accountSubscribe` |
| Known-signature notification | WebSocket `signatureSubscribe` |
| Simulation and submission | HTTP RPC |
| Final receipt and exact fee | Finalized HTTP transaction read |
| Executable portfolio valuation | Jupiter quotes plus account reads |

There is an operational cost to the open connection too. Helius meters WebSocket traffic, and richer feeds can deliver much more data than a narrowly filtered account subscription. The package reports received payload bytes; those are not an invoice or a prediction of a production bill. [Current metering](https://www.helius.dev/docs/rpc/websocket#pricing--metering)

<a id="run-the-same-commands" name="run-the-same-commands"></a>

## Run the same commands

The companion release requires Node.js 24 or newer. It is distributed as an npm archive on GitHub; it is not published in the npm registry.

```sh
npm install -g https://github.com/zeeshan8281/helius-portfolio-bot/releases/download/v0.1.2/helius-portfolio-bot-0.1.2.tgz
helius-bot init
helius-bot doctor
```

Enter a wallet address during setup for watch-only use. Then:

```sh
helius-bot watch --seconds 60
helius-bot compare --seconds 120 --poll-ms 2000 \
  --disconnect-after 40 --output comparison.json
```

The output file must not already exist. The comparison prints events and saves the report, including individual observations, connection events, and matched-state measurements. `--account` selects a different public account.

The live command requires a locally signing setup, funded with USDC and SOL for fees. It is a real purchase:

```sh
helius-bot stream-trade --live
helius-bot stream-status
```

One existing streaming attempt blocks another in that setup. `stream-status` inspects the saved signature and can reconcile its finalized result; it does not create or submit a replacement. An unresolved response is a reason to keep observing, not to delete the attempt file and try again.

Keys, API configuration, and signed attempt bytes stay in the private setup directory. The article and repository contain the public receipt and observation evidence.

<a id="what-this-experiment-establishes" name="what-this-experiment-establishes"></a>

## What this experiment establishes

The test suite passed 65 tests, including a real local WebSocket-server test of subscription restoration and checks that a replacement requires proven unspent expiry. Those tests are separate from the live Helius evidence: the 120-second mainnet account comparison, deliberate reconnect, one finalized 1 USDC swap, matching subscription slots, and independent finalized balance verification.

The public evidence includes the expired attempt's unspent proof, the successful trade receipt and its observation timeline, and the account comparison. It excludes API keys, signing keys, and signed transaction bytes. The validation record also identifies the package-install checks performed for this release.

The current implementation is a CLI account observer and a guarded streaming trade demonstration. It has no LLM decision layer, complete wallet-wide activity index, historical event replay, or automatic trading strategy triggered by subscriptions.

The application can listen for changes and still verify them. I can see when each observer noticed a transaction, inspect what happened during a reconnect, and point to finalized chain evidence for the money that moved.

[Source and release](https://github.com/zeeshan8281/helius-portfolio-bot) · [Streaming implementation](https://github.com/zeeshan8281/helius-portfolio-bot/blob/main/helius-stream.mjs) · [Live trade observer](https://github.com/zeeshan8281/helius-portfolio-bot/blob/main/stream-trade.mjs)
