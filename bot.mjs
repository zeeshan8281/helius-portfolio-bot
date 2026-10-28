import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { AddressLookupTableAccount, ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { OWNER, USDC, SOL, INPUT, checkBuild, priorityFee, checkSimulation } from './policy.mjs';

const dir = path.join(os.homedir(), '.local/share/helius-trading-bot');
const attemptFile = path.join(dir, 'one-usdc-attempt.json');
const configuration = () => JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
const owner = new PublicKey(OWNER);
const save = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2), { mode: 0o600 });
async function rpc(method, params) {
  const rpcUrl = new URL('https://mainnet.helius-rpc.com/');
  rpcUrl.searchParams.set('api-key', configuration().heliusApiKey);
  let res;
  try { res = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }), signal: AbortSignal.timeout(15_000) }); }
  catch { throw Error(`Helius ${method}: transport error; outcome may be unknown`); }
  if (!res.ok) throw Error(`Helius ${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw Error(`Helius ${method}: RPC ${body.error.code}: ${body.error.message}`);
  return body.result;
}
let lastBuildAt = 0;
async function requestBuild(params) {
  const config = configuration();
  if (!config.jupiterApiKey) await delay(Math.max(0, 2300 - (Date.now() - lastBuildAt)));
  lastBuildAt = Date.now();
  const headers = config.jupiterApiKey ? { 'x-api-key': config.jupiterApiKey } : {};
  const response = await fetch('https://api.jup.ag/swap/v2/build?' + new URLSearchParams(params), { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw Error(`Jupiter build HTTP ${response.status}`);
  return response.json();
}
async function balances(commitment = 'confirmed') {
  const [sol, tokens] = await Promise.all([
    rpc('getBalance', [OWNER, { commitment }]),
    rpc('getTokenAccountsByOwner', [OWNER, { mint: USDC }, { encoding: 'jsonParsed', commitment }]),
  ]);
  return { address: OWNER, solLamports: sol.value, usdcBaseUnits: tokens.value.reduce((n, a) => n + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n).toString(), accounts: tokens.value.map(a => a.pubkey), slot: sol.context.slot };
}
const toIx = ix => new TransactionInstruction({ programId: new PublicKey(ix.programId), keys: ix.accounts.map(a => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })), data: Buffer.from(ix.data, 'base64') });
function transaction(b, units, price) {
  const alts = Object.entries(b.addressesByLookupTableAddress ?? {}).map(([key, addresses]) => new AddressLookupTableAccount({ key: new PublicKey(key), state: { deactivationSlot: 18446744073709551615n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: addresses.map(a => new PublicKey(a)) } }));
  const body = [...b.setupInstructions, b.swapInstruction, ...(b.cleanupInstruction ? [b.cleanupInstruction] : []), ...b.otherInstructions];
  if (body.some(i => i.programId === ComputeBudgetProgram.programId.toBase58())) throw Error('Unexpected nested compute budget instruction');
  const message = new TransactionMessage({ payerKey: owner, recentBlockhash: bs58.encode(Buffer.from(b.blockhashWithMetadata.blockhash)), instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }), ...body.map(toIx)] }).compileToV0Message(alts);
  if (message.header.numRequiredSignatures !== 1 || !message.staticAccountKeys[0].equals(owner)) throw Error('Unexpected signer');
  return new VersionedTransaction(message);
}
async function prepare() {
  const started = Date.now();
  const before = await balances();
  if (BigInt(before.usdcBaseUnits) < INPUT || before.solLamports < 3_000_000) throw Error('Need at least 1 USDC and 0.003 SOL');
  if (before.accounts.length !== 1) throw Error('Test expects one USDC account');
  const b = await requestBuild({ inputMint: USDC, outputMint: SOL, amount: INPUT.toString(), taker: OWNER, slippageBps: '50', transactionVersion: '0', dexes: 'Kipseli' });
  checkBuild(b);
  const lifetime = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  b.blockhashWithMetadata = { blockhash: [...bs58.decode(lifetime.value.blockhash)], lastValidBlockHeight: lifetime.value.lastValidBlockHeight };
  const simulate = tx => rpc('simulateTransaction', [Buffer.from(tx.serialize()).toString('base64'), { encoding: 'base64', commitment: 'confirmed', sigVerify: false, replaceRecentBlockhash: false, accounts: { encoding: 'base64', addresses: [OWNER, before.accounts[0]] } }]);
  const first = await simulate(transaction(b, 1_400_000, 0n));
  if (first.value.err || !Number.isSafeInteger(first.value.unitsConsumed) || first.value.unitsConsumed <= 0) throw Error('Initial simulation failed: ' + JSON.stringify(first.value.err));
  const units = Math.ceil(first.value.unitsConsumed * 1.2);
  if (units > 1_400_000) throw Error('Compute margin exceeds transaction limit');
  const provisional = transaction(b, units, 0n);
  const estimate = await rpc('getPriorityFeeEstimate', [{ transaction: bs58.encode(provisional.serialize()), options: { recommended: true } }]);
  const fee = priorityFee(estimate.priorityFeeEstimate, units);
  const tx = transaction(b, units, fee.microLamports);
  const [final, network] = await Promise.all([
    simulate(tx), rpc('getFeeForMessage', [Buffer.from(tx.message.serialize()).toString('base64'), { commitment: 'confirmed' }]),
  ]);
  if (final.value.err || !final.value.accounts?.[0] || !final.value.accounts?.[1] || network.value === null) throw Error('Final simulation or fee calculation failed: ' + JSON.stringify(final.value.err));
  const tokenData = Buffer.from(final.value.accounts[1].data[0], 'base64');
  if (tokenData.length < 72 || !new PublicKey(tokenData.subarray(0, 32)).equals(new PublicKey(USDC)) || !new PublicKey(tokenData.subarray(32, 64)).equals(owner)) throw Error('Unexpected simulated USDC account');
  const afterUsdc = tokenData.readBigUInt64LE(64);
  save('last-simulation-check.json', { route: b.routePlan.map(r => r.swapInfo.label), beforeUsdc: before.usdcBaseUnits, afterUsdc: afterUsdc.toString(), beforeSol: before.solLamports, afterSol: final.value.accounts[0].lamports, minOut: b.otherAmountThreshold, networkFee: network.value, accounts: final.value.accounts });
  checkSimulation({ beforeUsdc: BigInt(before.usdcBaseUnits), afterUsdc, beforeSol: BigInt(before.solLamports), afterSol: BigInt(final.value.accounts[0].lamports), minOut: BigInt(b.otherAmountThreshold), networkFee: BigInt(network.value) });
  const height = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]);
  if (height + 15 >= b.blockhashWithMetadata.lastValidBlockHeight || Date.now() - started > 15_000) throw Error('Quote or blockhash too old; do not sign');
  const report = { checkedAt: new Date().toISOString(), before, quote: { inAmount: b.inAmount, outAmount: b.outAmount, minOut: b.otherAmountThreshold, slippageBps: b.slippageBps, priceImpactPct: b.priceImpactPct, route: b.routePlan.map(r => r.swapInfo.label) }, simulation: { err: final.value.err, unitsConsumed: final.value.unitsConsumed, unitsLimit: units, priorityMicroLamports: fee.microLamports.toString(), priorityLamports: fee.lamports.toString(), networkFeeLamports: network.value, afterUsdc: afterUsdc.toString(), afterSolLamports: final.value.accounts[0].lamports }, recentBlockhash: tx.message.recentBlockhash, lastValidBlockHeight: b.blockhashWithMetadata.lastValidBlockHeight, quoteAgeMs: Date.now() - started };
  save('last-simulation.json', report);
  return { tx, report };
}
async function status(attempt) {
  const result = await rpc('getSignatureStatuses', [[attempt.signature], { searchTransactionHistory: true }]);
  const s = result.value[0];
  let state = 'unknown';
  if (s && ['confirmed', 'finalized'].includes(s.confirmationStatus)) state = s.err === null ? s.confirmationStatus : 'failed';
  if (!s) {
    const height = await rpc('getBlockHeight', [{ commitment: 'finalized' }]);
    if (height > attempt.lastValidBlockHeight) state = 'expired-or-unobserved';
  }
  return { signature: attempt.signature, state, status: s, checkedAt: new Date().toISOString() };
}
async function settle(attempt) {
  const chain = await rpc('getTransaction', [attempt.signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
  if (!chain?.meta || chain.meta.err !== null) throw Error('Finalized execution metadata is unavailable or reports failure');
  save('settled-transaction.json', chain);
  const index = chain.transaction.message.accountKeys.indexOf(OWNER);
  if (index < 0) throw Error('Wallet missing from confirmed transaction');
  const usdc = entries => entries.filter(e => e.owner === OWNER && e.mint === USDC).reduce((n, e) => n + BigInt(e.uiTokenAmount.amount), 0n);
  const beforeUsdc = usdc(chain.meta.preTokenBalances);
  const afterUsdc = usdc(chain.meta.postTokenBalances);
  const beforeSol = BigInt(chain.meta.preBalances[index]);
  const afterSol = BigInt(chain.meta.postBalances[index]);
  checkSimulation({ beforeUsdc, afterUsdc, beforeSol, afterSol, minOut: BigInt(attempt.quote.minOut), networkFee: BigInt(chain.meta.fee) });
  const receipt = { signature: attempt.signature, state: 'finalized-and-reconciled', slot: chain.slot, blockTime: chain.blockTime, usdcSpentBaseUnits: (beforeUsdc - afterUsdc).toString(), solReceivedBeforeNetworkFeeLamports: (afterSol - beforeSol + BigInt(chain.meta.fee)).toString(), networkFeeLamports: chain.meta.fee, beforeSolLamports: beforeSol.toString(), afterSolLamports: afterSol.toString(), remainingUsdcBaseUnits: afterUsdc.toString(), minimumOutputLamports: attempt.quote.minOut, quoteOutputLamports: attempt.quote.outAmount, explorer: 'https://solscan.io/tx/' + attempt.signature };
  save('receipt.json', receipt);
  save('balances-after.json', await balances());
  return receipt;
}
async function execute() {
  if (fs.existsSync(attemptFile)) throw Error('An attempt already exists. Use status; a second swap is forbidden.');
  const { tx, report } = await prepare();
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(path.join(dir, 'bot-wallet.json'), 'utf8')));
  const signer = await Keypair.fromSecretKey(secret);
  if (!signer.publicKey.equals(owner)) throw Error('Wrong wallet');
  await tx.sign([signer]);
  secret.fill(0);
  const signature = bs58.encode(tx.signatures[0]);
  const wire = Buffer.from(tx.serialize()).toString('base64');
  const attempt = { ...report, signature, wire, state: 'signed-before-send' };
  // Persist identity before any network send; never rebuild after an ambiguous response.
  const fd = fs.openSync(attemptFile, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(attempt, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  console.log(JSON.stringify({ state: 'signed-and-persisted', signature, simulation: report.simulation }));
  try {
    const received = await rpc('sendTransaction', [wire, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }]);
    if (received !== signature) throw Error('Returned signature mismatch');
    console.log(JSON.stringify({ state: 'accepted-by-rpc', signature }));
  } catch (error) {
    console.log(JSON.stringify({ state: 'submission-unresolved', signature, message: error.message }));
  }
  for (let n = 0; n < 25; n++) {
    const observed = await status(attempt);
    save('last-status.json', observed);
    if (['finalized', 'failed', 'expired-or-unobserved'].includes(observed.state)) {
      console.log(JSON.stringify(observed, null, 2));
      if (observed.state === 'finalized') {
        console.log(JSON.stringify(await settle(attempt), null, 2));
      }
      return;
    }
    if (observed.state === 'unknown' && n % 2 === 1) {
      const height = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]);
      if (height < attempt.lastValidBlockHeight) {
        try { await rpc('sendTransaction', [wire, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }]); }
        catch { /* Keep observing the persisted signature after any rebroadcast error. */ }
      }
    }
    await delay(2000);
  }
  console.log(JSON.stringify({ signature, state: 'still-unresolved-use-status', automaticReplacement: false }));
}
async function executeCommand(retryExpired = false) {
  const lock = path.join(dir, 'execution.lock');
  const fd = fs.openSync(lock, 'wx', 0o600);
  fs.closeSync(fd);
  try {
    if (retryExpired) {
      const previous = JSON.parse(fs.readFileSync(attemptFile, 'utf8'));
      const observed = await status(previous);
      const [valid, chain, now] = await Promise.all([
        rpc('isBlockhashValid', [previous.recentBlockhash, { commitment: 'finalized' }]),
        rpc('getTransaction', [previous.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }]),
        balances('finalized'),
      ]);
      if (observed.state !== 'expired-or-unobserved' || valid.value !== false || chain !== null ||
          now.usdcBaseUnits !== previous.before.usdcBaseUnits || now.solLamports !== previous.before.solLamports)
        throw Error('Cannot prove the previous attempt expired without spending funds. Replacement refused.');
      const archive = path.join(dir, `expired-${previous.signature}.json`);
      if (fs.existsSync(archive)) throw Error('Expired attempt archive already exists');
      fs.renameSync(attemptFile, archive);
      console.log(JSON.stringify({ state: 'expired-unspent-attempt-archived', signature: previous.signature }));
    }
    await execute();
  } finally { fs.unlinkSync(lock); }
}
export { rpc, requestBuild, transaction as buildTransaction, balances, owner, dir as stateDir };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
try {
  const command = process.argv[2];
  if (command === 'balances') console.log(JSON.stringify(await balances(), null, 2));
  else if (command === 'simulate') console.log(JSON.stringify((await prepare()).report, null, 2));
  else if (command === 'execute') await executeCommand(process.argv[3] === '--retry-expired');
  else if (command === 'status') {
    const attempt = JSON.parse(fs.readFileSync(attemptFile, 'utf8'));
    const observed = await status(attempt);
    console.log(JSON.stringify(observed, null, 2));
    if (observed.state === 'finalized') console.log(JSON.stringify(await settle(attempt), null, 2));
  }
  else throw Error('Use balances, simulate, execute, or status');
} catch (error) { console.error(error.message); process.exitCode = 1; }
}
