export { OWNER } from './runtime.mjs';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOL = 'So11111111111111111111111111111111111111112';
export const INPUT = 1_000_000n;
export const MAX_PRIORITY_FEE = 50_000n;
export const MAX_NETWORK_FEE = 60_000n;
export function checkBuild(b) {
  if (b.inputMint !== USDC || b.outputMint !== SOL || BigInt(b.inAmount) !== INPUT)
    throw Error('Route does not match the authorized 1 USDC to SOL trade');
  if (b.swapMode !== 'ExactIn' || b.slippageBps !== 50 || b.transactionVersion !== 0)
    throw Error('Unexpected swap mode, slippage, or transaction version');
  if (!b.routePlan?.length || BigInt(b.otherAmountThreshold) <= 0n ||
      BigInt(b.otherAmountThreshold) > BigInt(b.outAmount)) throw Error('Invalid quote output');
  if (BigInt(b.otherAmountThreshold) < BigInt(b.outAmount) * 9950n / 10_000n)
    throw Error('Minimum output violates the 0.5 percent slippage limit');
  if (!Number.isFinite(Number(b.priceImpactPct)) || Math.abs(Number(b.priceImpactPct)) > 0.01)
    throw Error('Price impact exceeds 1 percent');
  if (b.tipInstruction) throw Error('This test does not authorize an extra tip');
  if (b.swapInstruction?.programId !== 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')
    throw Error('Unexpected Jupiter program');
  if (!Array.isArray(b.blockhashWithMetadata?.blockhash) || b.blockhashWithMetadata.blockhash.length !== 32 ||
      !Number.isSafeInteger(b.blockhashWithMetadata.lastValidBlockHeight)) throw Error('Invalid blockhash metadata');
}
export function priorityFee(price, units) {
  if (!Number.isFinite(price) || price < 0 || !Number.isSafeInteger(Math.ceil(price))) throw Error('Invalid fee estimate');
  const microLamports = BigInt(Math.ceil(price));
  const lamports = (microLamports * BigInt(units) + 999_999n) / 1_000_000n;
  if (lamports > MAX_PRIORITY_FEE) throw Error('Priority fee exceeds 50,000 lamport cap');
  return { microLamports, lamports };
}
export function checkSimulation({ beforeUsdc, afterUsdc, beforeSol, afterSol, minOut, networkFee }) {
  if (beforeUsdc - afterUsdc !== INPUT) throw Error('Simulated USDC debit is not exactly 1 USDC');
  if (networkFee < 0n || networkFee > MAX_NETWORK_FEE) throw Error('Network fee exceeds cap');
  if (afterSol - beforeSol + networkFee < minOut) throw Error('Simulated SOL receipt is below the minimum');
}
