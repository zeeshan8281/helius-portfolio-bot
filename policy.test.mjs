import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priorityFee, checkSimulation, checkBuild, INPUT, USDC, SOL } from './policy.mjs';
test('priority fee rounds up in lamports and refuses over-budget estimates', () => {
  assert.deepEqual(priorityFee(100_000, 300_000), { microLamports: 100_000n, lamports: 30_000n });
});
test('fee cap and malformed estimates fail closed', () => {
  assert.throws(() => priorityFee(200_000, 300_000), /exceeds/);
  assert.throws(() => priorityFee(NaN, 300_000), /Invalid/);
  assert.deepEqual(priorityFee(1.1, 300_000), { microLamports: 2n, lamports: 1n });
});
test('simulation requires exact USDC spend and minimum SOL receipt', () => {
  const good = { beforeUsdc: 3n * INPUT, afterUsdc: 2n * INPUT, beforeSol: 5_000_000n, afterSol: 14_995_000n, minOut: 9_900_000n, networkFee: 5_000n };
  assert.doesNotThrow(() => checkSimulation(good));
  assert.throws(() => checkSimulation({ ...good, afterUsdc: 0n }), /debit/);
  assert.throws(() => checkSimulation({ ...good, afterSol: 5_000_000n }), /minimum/);
});
test('quote validation rejects a larger debit, different mint, or excessive output slippage', () => {
  const build = { inputMint: USDC, outputMint: SOL, inAmount: '1000000', outAmount: '10000000', otherAmountThreshold: '9950000', swapMode: 'ExactIn', slippageBps: 50, transactionVersion: 0, priceImpactPct: '0.001', routePlan: [{}], swapInstruction: { programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' }, blockhashWithMetadata: { blockhash: Array(32).fill(1), lastValidBlockHeight: 123 } };
  assert.doesNotThrow(() => checkBuild(build));
  assert.throws(() => checkBuild({ ...build, inAmount: '3000000' }), /authorized/);
  assert.throws(() => checkBuild({ ...build, inputMint: SOL }), /authorized/);
  assert.throws(() => checkBuild({ ...build, otherAmountThreshold: '1' }), /slippage/);
});
