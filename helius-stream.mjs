import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

export const CLOCK = 'SysvarC1ock11111111111111111111111111111111';
export const emit = event => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
export function accountFingerprint(value) {
  if (value === null) return 'missing';
  return createHash('sha256').update(JSON.stringify([value.lamports, value.owner, value.executable, value.data])).digest('hex');
}
export async function readRpc(apiKey, method, params) {
  const url = new URL('https://mainnet.helius-rpc.com/'); url.searchParams.set('api-key', apiKey);
  let response;
  try { response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10_000) }); }
  catch { throw Error(`Helius ${method}: transport error`); }
  if (!response.ok) throw Error(`Helius ${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw Error(`Helius ${method}: RPC error ${body.error.code}`);
  return body.result;
}

// A disconnected session has no replay cursor. Consumers reconcile through HTTP on every ready event.
export class HeliusStream {
  constructor(apiKey, subscriptions, onEvent, options = {}) {
    this.apiKey = apiKey; this.subscriptions = subscriptions; this.onEvent = onEvent;
    this.url = options.url; this.heartbeatMs = options.heartbeatMs ?? 20_000;
    this.retryMs = options.retryMs ?? 1000; this.stopped = false; this.generation = 0;
    this.stats = { connections: 0, reconnects: 0, acknowledgements: 0, notifications: 0, bytes: 0 };
  }
  event(event) { this.onEvent({ elapsedMs: performance.now(), ...event }); }
  start() { this.connect(); return this; }
  connect() {
    if (this.stopped) return;
    const generation = ++this.generation;
    const url = this.url ?? `wss://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(this.apiKey)}`;
    const ws = this.ws = new WebSocket(url, { maxPayload: 1_048_576, handshakeTimeout: 10_000 });
    const pending = new Map(), active = new Map(); let pong = true, ready = false;
    const timeout = setTimeout(() => { if (!ready) { this.event({ type: 'subscription-timeout' }); ws.terminate(); } }, 15_000);
    const current = () => !this.stopped && generation === this.generation;
    let heartbeat;
    ws.on('open', () => {
      if (!current()) return ws.terminate();
      this.stats.connections++; this.event({ type: 'connected', generation });
      this.subscriptions.forEach((s, i) => { const id = i + 1; pending.set(id, s); ws.send(JSON.stringify({ jsonrpc: '2.0', id, method: s.method, params: s.params })); });
      heartbeat = setInterval(() => { if (!pong) return ws.terminate(); pong = false; ws.ping(); }, this.heartbeatMs);
    });
    ws.on('pong', () => { pong = true; });
    ws.on('message', data => {
      if (!current()) return;
      this.stats.bytes += data.length;
      let message;
      try { message = JSON.parse(data.toString()); } catch { this.event({ type: 'invalid-message' }); return ws.terminate(); }
      if (pending.has(message.id)) {
        const spec = pending.get(message.id); pending.delete(message.id);
        if (message.error || !Number.isSafeInteger(message.result)) {
          this.event({ type: 'subscription-rejected', name: spec.name, code: message.error?.code ?? null });
          this.fatal = true; return ws.terminate();
        }
        active.set(message.result, spec); this.stats.acknowledgements++;
        this.event({ type: 'subscribed', name: spec.name, generation });
        if (pending.size === 0) { ready = true; clearTimeout(timeout); this.event({ type: 'ready', generation }); }
        return;
      }
      const spec = active.get(message.params?.subscription);
      if (spec && message.method?.endsWith('Notification')) {
        this.stats.notifications++; this.event({ type: 'notification', name: spec.name, method: message.method, result: message.params.result, generation });
      }
    });
    ws.on('error', () => { if (current()) this.event({ type: 'connection-error' }); });
    ws.on('close', code => {
      clearTimeout(timeout); clearInterval(heartbeat);
      if (!current()) return;
      this.event({ type: 'disconnected', code, generation });
      if (this.fatal) { this.event({ type: 'fatal', reason: 'Subscription rejected; check method and plan access.' }); return; }
      const backoff = Math.min(30_000, this.retryMs * 2 ** Math.min(this.failures ?? 0, 5));
      this.failures = ready ? 0 : (this.failures ?? 0) + 1;
      this.retry = setTimeout(() => { this.stats.reconnects++; this.connect(); }, backoff + Math.random() * this.retryMs / 4);
    });
  }
  disconnect() { this.ws?.terminate(); }
  stop() { this.stopped = true; clearTimeout(this.retry); this.ws?.terminate(); }
}

export function summarizeComparison(observations) {
  const first = { http: new Map(), websocket: new Map() };
  for (const o of observations) if (!first[o.source].has(o.hash)) first[o.source].set(o.hash, o);
  const pairs = [...first.websocket].filter(([hash]) => first.http.has(hash)).map(([hash, w]) => ({ hash, slot: w.slot,
    websocketMs: w.ms, httpMs: first.http.get(hash).ms, httpMinusWebsocketMs: Math.round((first.http.get(hash).ms - w.ms) * 1000) / 1000 }));
  const lags = pairs.map(p => p.httpMinusWebsocketMs).sort((a,b) => a-b);
  const percentile = p => lags.length ? lags[Math.ceil(p * lags.length) - 1] : null;
  return { uniqueWebsocketStates: first.websocket.size, uniqueHttpStates: first.http.size, matchedStates: pairs.length,
    websocketOnlyStates: [...first.websocket.keys()].filter(k => !first.http.has(k)).length,
    httpOnlyStates: [...first.http.keys()].filter(k => !first.websocket.has(k)).length,
    websocketFirstPairs: lags.filter(n => n > 0).length, httpFirstPairs: lags.filter(n => n < 0).length,
    medianHttpMinusWebsocketMs: percentile(0.5), p95HttpMinusWebsocketMs: percentile(0.95), pairs };
}

export async function observeAccount({ apiKey, account, seconds = 60, pollMs = 2000, compare = false, disconnectAfter = 0, onEvent = emit, signal }) {
  const start = performance.now(), observations = [], lifecycle = [], pending = new Set();
  let finished = false, streamFailure = false, requestCount = 0, httpErrors = 0, reconciliations = 0;
  const record = event => { if (!finished) onEvent(event); };
  const observe = (source, result) => {
    if (finished) return;
    if (!result?.context || !Number.isSafeInteger(result.context.slot) || !Object.hasOwn(result, 'value')) throw Error('Invalid account result');
    if (observations.length >= 20_000) throw Error('Observation limit reached');
    const item = { source, ms: Math.round((performance.now()-start)*1000)/1000, slot: result.context.slot, hash: accountFingerprint(result.value), lamports: result.value?.lamports ?? null };
    observations.push(item); record({ type: 'account', ...item, account, commitment: 'confirmed' });
  };
  const snapshot = async (source = 'snapshot') => {
    requestCount++;
    try {
      const result = await readRpc(apiKey, 'getAccountInfo', [account, { commitment: 'confirmed', encoding: 'base64' }]);
      if (finished) return;
      if (source === 'http') observe('http', result);
      else { reconciliations++; record({ type: 'snapshot-reconciled', slot: result.context.slot, hash: accountFingerprint(result.value), lamports: result.value?.lamports ?? null,
        limitation: 'Current account state only; intermediate updates during disconnection are not replayed.' }); }
    } catch { httpErrors++; record({ type: 'rpc-error', source }); }
  };
  const track = task => { pending.add(task); task.finally(() => pending.delete(task)); return task; };
  const stream = new HeliusStream(apiKey, [{ name: 'account', method: 'accountSubscribe', params: [account, { commitment: 'confirmed', encoding: 'base64' }] }], event => {
    try {
      if (event.type === 'notification') observe('websocket', event.result);
      else {
        const item = { ...event, elapsedMs: Math.round(event.elapsedMs-start) }; lifecycle.push(item); record(item);
        if (event.type === 'ready') track(snapshot());
        if (event.type === 'fatal') streamFailure = true;
      }
    } catch { streamFailure = true; record({ type: 'invalid-account-event' }); stream.stop(); }
  }).start();
  const disconnect = disconnectAfter ? setTimeout(() => { record({ type: 'deliberate-disconnect' }); stream.disconnect(); }, disconnectAfter*1000) : null;
  const aborted = new Promise(resolve => { if (signal?.aborted) resolve(); else signal?.addEventListener('abort', resolve, { once: true }); });
  const polling = async () => { while (!finished && compare) { await snapshot('http'); if (!finished) await delay(pollMs); } };
  const poller = polling();
  let durationTimer;
  try { await Promise.race([new Promise(resolve => { durationTimer = setTimeout(resolve, seconds*1000); }), aborted]); }
  finally { finished = true; clearTimeout(durationTimer); clearTimeout(disconnect); stream.stop(); }
  await Promise.allSettled([poller, ...pending]);
  const result = { schema: 'helius-stream-comparison-v1', account, commitment: 'confirmed', startedAt: new Date(Date.now()-(performance.now()-start)).toISOString(),
    seconds, pollMs: compare ? pollMs : null, compare, completed: !signal?.aborted, streamFailure, httpRequests: requestCount, httpErrors, reconciliations,
    stream: stream.stats, summary: summarizeComparison(observations), lifecycle, observations,
    limits: 'Single-account observation at confirmed commitment. Matched-state arrival difference is not transaction inclusion latency. Snapshots after reconnect do not replay intermediate states.' };
  onEvent({ type: 'summary', ...result, observations: undefined, lifecycle: undefined });
  if (streamFailure || !stream.stats.acknowledgements) throw Error('WebSocket subscription was not healthy; inspect the emitted evidence.');
  return result;
}
