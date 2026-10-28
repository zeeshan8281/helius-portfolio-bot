import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { prepare, rpc, status, settle, balances, owner, stateDir } from './bot.mjs';
import { HeliusStream, emit } from './helius-stream.mjs';

const writeNew = (file, value) => {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)+'\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};
export function canReplaceExpired(previous, observed, valid, chain, wallet) {
  return observed?.state === 'expired-or-unobserved' && valid?.value === false && chain === null &&
    wallet?.usdcBaseUnits === previous.before.usdcBaseUnits && wallet?.solLamports === previous.before.solLamports;
}
export async function streamTrade({ apiKey, live, retryExpired = false, onEvent = emit }) {
  if (live !== true) throw Error('stream-trade requires explicit --live for one 1 USDC -> SOL swap.');
  const attemptFile = path.join(stateDir, 'stream-swap-attempt.json');
  const receiptFile = path.join(stateDir, 'stream-swap-evidence.json');
  const lock = path.join(stateDir, 'execution.lock');
  const fd = fs.openSync(lock, 'wx', 0o600); fs.closeSync(fd);
  let stream;
  const events = [], record = event => { events.push({ at: new Date().toISOString(), ...event }); onEvent(events.at(-1)); };
  try {
    if (retryExpired) {
      const previous = JSON.parse(fs.readFileSync(attemptFile, 'utf8'));
      const [observed, valid, chain, wallet] = await Promise.all([
        status(previous), rpc('isBlockhashValid', [previous.recentBlockhash, { commitment: 'finalized' }]),
        rpc('getTransaction', [previous.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }]), balances('finalized'),
      ]);
      if (!canReplaceExpired(previous, observed, valid, chain, wallet))
        throw Error('Cannot prove finalized expiry without spending. Replacement refused.');
      const archive = path.join(stateDir, `stream-swap-expired-${previous.signature}.json`);
      writeNew(archive, { ...previous, expiryProof: { checkedAt: new Date().toISOString(), blockhashValid: false, transactionAbsent: true, unchangedWallet: wallet } });
      fs.unlinkSync(attemptFile);
      if (fs.existsSync(receiptFile)) fs.renameSync(receiptFile, path.join(stateDir, `stream-swap-evidence-${previous.signature}.json`));
      record({ type: 'expired-unspent-archived', signature: previous.signature });
    }
    if (fs.existsSync(attemptFile) || fs.existsSync(receiptFile) || !retryExpired && fs.readdirSync(stateDir).some(n => n.startsWith('stream-swap-expired-')))
      throw Error('A streaming swap already exists. Inspect its original signature; replacement needs --retry-expired and finalized proof.');
    const { tx, report } = await prepare();
    const key = Uint8Array.from(JSON.parse(fs.readFileSync(path.join(stateDir, 'bot-wallet.json'), 'utf8')));
    let signer;
    try { signer = await Keypair.fromSecretKey(key); } finally { key.fill(0); }
    if (!signer.publicKey.equals(owner)) throw Error('Wrong signing wallet');
    await tx.sign([signer]);
    const signature = bs58.encode(tx.signatures[0]);
    const wire = Buffer.from(tx.serialize()).toString('base64');
    let readyResolve, rejected = false;
    const ready = new Promise(resolve => { readyResolve = resolve; });
    stream = new HeliusStream(apiKey, [
      { name: 'signature-confirmed', method: 'signatureSubscribe', params: [signature, { commitment: 'confirmed', enableReceivedNotification: false }] },
      { name: 'signature-finalized', method: 'signatureSubscribe', params: [signature, { commitment: 'finalized', enableReceivedNotification: false }] },
      { name: 'wallet-sol', method: 'accountSubscribe', params: [owner.toBase58(), { commitment: 'confirmed', encoding: 'base64' }] },
      { name: 'wallet-usdc', method: 'accountSubscribe', params: [report.before.accounts[0], { commitment: 'confirmed', encoding: 'base64' }] },
    ], event => {
      if (event.type === 'ready') readyResolve(true);
      if (event.type === 'fatal') { rejected = true; readyResolve(false); }
      if (event.type === 'notification') record({ type: 'websocket', name: event.name, signature, slot: event.result?.context?.slot,
        err: event.name.startsWith('signature') ? event.result?.value?.err : undefined, observedMs: performance.now() });
      else record({ type: event.type, name: event.name, generation: event.generation });
    }).start();
    let readyTimer;
    const didSubscribe = await Promise.race([ready, new Promise(resolve => { readyTimer = setTimeout(() => resolve(false), 10_000); })]);
    clearTimeout(readyTimer);
    if (!didSubscribe || rejected) throw Error('WebSocket subscriptions were not acknowledged; no transaction submitted.');
    const height = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]);
    if (height + 15 >= report.lastValidBlockHeight || Date.now()-Date.parse(report.checkedAt) + report.quoteAgeMs > 15_000)
      throw Error('Quote or blockhash too old after subscription setup; no transaction submitted.');
    const attempt = { ...report, signature, wire, state: 'signed-before-send', authorization: { inputUsdcAtomic: '1000000', output: 'native-SOL', maxTransactions: 1,
      maxNetworkFeeLamports: 60000, source: 'Explicit stream-trade --live command; separate from the closed portfolio run.' } };
    writeNew(attemptFile, attempt);
    const started = performance.now();
    record({ type: 'signed-and-persisted', signature, inputUsdc: '1', minimumSolLamports: report.quote.minOut });
    const polling = (async () => {
      let lastState;
      for (let n=0;n<90;n++) {
        const observed = await status(attempt);
        if (observed.state !== lastState) { record({ type: 'http-status', signature, state: observed.state, slot: observed.status?.slot, elapsedMs: performance.now()-started, observedMs: performance.now() }); lastState=observed.state; }
        if (['finalized','failed','expired-or-unobserved'].includes(observed.state)) return observed;
        if (observed.state === 'unknown' && n % 2 === 1) {
          const height = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]);
          if (height + 2 < attempt.lastValidBlockHeight) {
            try { await rpc('sendTransaction', [wire, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }]);
              record({ type: 'same-bytes-rebroadcast', signature }); }
            catch { record({ type: 'rebroadcast-unresolved', signature }); }
          }
        }
        await delay(2000);
      }
      return { state: 'unresolved', signature };
    })();
    try {
      const received = await rpc('sendTransaction', [wire, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }]);
      if (received !== signature) throw Error('Returned signature mismatch');
      record({ type: 'submitted', signature, elapsedMs: performance.now()-started });
    } catch { record({ type: 'submission-unresolved', signature }); }
    const observed = await polling;
    // Finalized HTTP metadata remains the authority even when WebSocket arrives earlier.
    const receipt = observed.state === 'finalized' ? await settle(attempt) : null;
    await delay(2000);
    const comparisons = ['confirmed','finalized'].map(commitment => {
      const w = events.find(e => e.type === 'websocket' && e.name === `signature-${commitment}`);
      const h = events.find(e => e.type === 'http-status' && e.state === commitment);
      return { commitment, websocketObserved: !!w, httpObserved: !!h,
        httpMinusWebsocketMs: w && h ? Math.round((h.observedMs-w.observedMs)*1000)/1000 : null };
    });
    const evidence = { schema: 'helius-live-stream-swap-v1', signature, state: receipt?.state ?? observed.state, receipt,
      pollIntervalMs: 2000, commitmentMatchedComparisons: comparisons, stream: stream.stats, events,
      limit: 'One transaction observed on one client. Arrival differences are not chain execution speed or a general performance guarantee.' };
    writeNew(receiptFile, evidence); record({ type: 'trade-result', signature, state: evidence.state, comparisons, receipt });
    if (!receipt) throw Error(`Trade ${observed.state}; observe the saved original signature. Never repeat stream-trade in another directory to replace it.`);
    return evidence;
  } finally { stream?.stop(); fs.unlinkSync(lock); }
}

export async function streamStatus() {
  const attempt = JSON.parse(fs.readFileSync(path.join(stateDir, 'stream-swap-attempt.json'), 'utf8'));
  const observation = await status(attempt);
  return observation.state === 'finalized' ? await settle(attempt) : observation;
}
