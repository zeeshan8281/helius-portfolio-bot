import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { rpc, requestBuild, stateDir } from './bot.mjs';
import { OWNER, USDC, SOL } from './policy.mjs';

// Read-only: this module never loads a signing key or submits transactions.
const registry = JSON.parse(fs.readFileSync(new URL('./assets.json', import.meta.url), 'utf8'));
const assets = registry.assets;
const inputUsdc = 650_000n;
let lastBuildAt = 0;
async function quote(inputMint, outputMint, amount) {
  await delay(Math.max(0, 2300 - (Date.now() - lastBuildAt)));
  lastBuildAt = Date.now();
  const data = await requestBuild({ inputMint, outputMint, amount: amount.toString(), taker: OWNER, slippageBps: '50', transactionVersion: '0' });
  if (data.inputMint !== inputMint || data.outputMint !== outputMint || BigInt(data.inAmount) !== amount ||
      data.swapMode !== 'ExactIn' || data.slippageBps !== 50 || !data.routePlan?.length ||
      BigInt(data.otherAmountThreshold) <= 0n || BigInt(data.otherAmountThreshold) > BigInt(data.outAmount))
    throw Error('Invalid quote identity or amounts');
  return { observedAt: new Date().toISOString(), inputMint, outputMint, inputAtomic: data.inAmount, outputAtomic: data.outAmount, minimumOutputAtomic: data.otherAmountThreshold, priceImpactRatio: data.priceImpactPct, route: data.routePlan.map(p => p.swapInfo.label) };
}
const [mints, native, classic, extension, rent] = await Promise.all([
  rpc('getMultipleAccounts', [assets.map(a => a.mint), { encoding: 'jsonParsed', commitment: 'finalized' }]),
  rpc('getBalance', [OWNER, { commitment: 'finalized' }]),
  rpc('getTokenAccountsByOwner', [OWNER, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed', commitment: 'finalized' }]),
  rpc('getTokenAccountsByOwner', [OWNER, { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' }, { encoding: 'jsonParsed', commitment: 'finalized' }]),
  rpc('getMinimumBalanceForRentExemption', [165]),
]);
const report = { observedAt: new Date().toISOString(), owner: OWNER, readOnly: true, executionApproved: false, slot: native.context.slot,
  nativeSolLamports: native.value, current165ByteAccountRentLamports: rent,
  holdings: [...classic.value, ...extension.value].map(a => ({ account: a.pubkey, program: a.account.owner, rentLamports: a.account.lamports, info: a.account.data.parsed.info })),
  assets: [], quotes: [], quoteErrors: [] };
for (let i = 0; i < assets.length; i++) {
  const identity = assets[i]; const account = mints.value[i]; const info = account?.data?.parsed?.info;
  if (!info || !['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'].includes(account.owner))
    throw Error(`Missing or unexpected token program for ${identity.symbol}`);
  if (identity.decimals !== null && identity.decimals !== undefined && info.decimals !== identity.decimals)
    throw Error(`Decimal mismatch for ${identity.symbol}`);
  if (identity.documentedMintAuthority && identity.documentedMintAuthority !== info.mintAuthority)
    throw Error(`Mint authority mismatch for ${identity.symbol}`);
  report.assets.push({ symbol: identity.symbol, mint: identity.mint, tokenProgram: account.owner, mintInfo: info, primaryProofUrls: identity.primaryProofUrls });
}
for (const asset of assets.filter(a => a.symbol !== 'SOL')) {
  try {
    const buy = await quote(USDC, asset.mint, inputUsdc);
    const sell = await quote(asset.mint, USDC, BigInt(buy.minimumOutputAtomic));
    report.quotes.push({ symbol: asset.symbol, buy, conservativeSell: sell,
      minimumRoundTripUsdcAtomic: sell.minimumOutputAtomic,
      quoteOnlyFrictionUsdcAtomic: (inputUsdc - BigInt(sell.minimumOutputAtomic)).toString(),
      excludesNetworkFeesAndRent: true });
  } catch (error) { report.quoteErrors.push({ symbol: asset.symbol, error: error.message }); }
}
try { report.nativeSolQuote = await quote(SOL, USDC, BigInt(native.value)); }
catch (error) { report.quoteErrors.push({ symbol: 'SOL', error: error.message }); }
report.completedAt = new Date().toISOString();
report.valuationLimit = 'Quotes are not fills or verified full-liquidation proceeds. Native SOL must retain a fee reserve. Account rent is a deposit; recovery must be verified separately.';
const folder = path.join(stateDir, 'portfolio-observations');
fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
const file = path.join(folder, report.completedAt.replace(/[:.]/g, '-') + '.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
