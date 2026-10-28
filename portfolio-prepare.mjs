import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import bs58 from 'bs58';
import { AddressLookupTableAccount, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { rpc, requestBuild, buildTransaction, stateDir, owner } from './bot.mjs';
import { OWNER, USDC, SOL, MAX_PRIORITY_FEE, priorityFee } from './policy.mjs';
import { checkPortfolioQuote, checkPortfolioSimulation, ENTRY_USDC_ATOMIC, MIN_GAS_LAMPORTS } from './portfolio-policy.mjs';
import registry from './assets.json' with { type: 'json' };
import { verifyJupiterSwapInstruction as checkJupiterSwapInstruction } from './portfolio-jupiter-decode.mjs';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM = '11111111111111111111111111111111';
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
export function normalizeClosedAccount(account) {
  return account && account.owner === SYSTEM && account.lamports === 0 && account.executable === false &&
    Array.isArray(account.data) && account.data[0] === '' && account.data[1] === 'base64' ? null : account;
}
export function boundedPriorityFee(estimate, units) {
  if (!Number.isFinite(estimate) || estimate < 0 || !Number.isSafeInteger(Math.ceil(estimate)) || !Number.isSafeInteger(units) || units <= 0)
    throw Error('Invalid fee estimate or compute limit');
  // A fee recommendation is advisory; never increase the spending cap to follow it.
  const maximumPrice = Number(MAX_PRIORITY_FEE * 1_000_000n / BigInt(units));
  return priorityFee(Math.min(estimate, maximumPrice), units);
}
async function associated(mint) {
  const [address] = await PublicKey.findProgramAddress([owner.toBytes(), new PublicKey(TOKEN).toBytes(), new PublicKey(mint).toBytes()], ATA);
  return address.toBase58();
}
export function decodeTokenAccount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (account.owner !== TOKEN || data.length !== 165) throw Error('Only inspected classic 165-byte token accounts are supported');
  const delegateOption = data.readUInt32LE(72), closeOption = data.readUInt32LE(129);
  if (![0, 1].includes(delegateOption) || ![0, 1].includes(closeOption)) throw Error('Invalid token authority flags');
  return { mint: new PublicKey(data.subarray(0, 32)).toBase58(), owner: new PublicKey(data.subarray(32, 64)).toBase58(),
    amountAtomic: data.readBigUInt64LE(64), delegate: delegateOption ? new PublicKey(data.subarray(76, 108)).toBase58() : null,
    delegatedAmount: data.readBigUInt64LE(121), closeAuthority: closeOption ? new PublicKey(data.subarray(133, 165)).toBase58() : null,
    state: data[108] === 1 ? 'initialized' : data[108] === 2 ? 'frozen' : 'uninitialized', tokenProgram: account.owner,
    lamports: BigInt(account.lamports), addressSpace: data.length };
}
export async function snapshotWallet(extraAddresses = [], commitment = 'confirmed') {
  const discovered = await rpc('getTokenAccountsByOwner', [OWNER, { programId: TOKEN }, { encoding: 'base64', commitment }]);
  const extended = await rpc('getTokenAccountsByOwner', [OWNER, { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' }, { encoding: 'base64', commitment }]);
  if (extended.value.length) throw Error('Uninspected token-extension holdings require review before portfolio execution');
  const addresses = [...new Set([OWNER, ...discovered.value.map(a => a.pubkey), ...extraAddresses])];
  const observed = await rpc('getMultipleAccounts', [addresses, { encoding: 'base64', commitment, minContextSlot: Math.max(discovered.context.slot, extended.context.slot) }]);
  const accounts = Object.fromEntries(addresses.map((a, i) => [a, a === OWNER ? observed.value[i] : normalizeClosedAccount(observed.value[i])]));
  if (accounts[OWNER]?.owner !== SYSTEM) throw Error('Unexpected wallet account owner');
  return { addresses, accounts, tokenAccounts: Object.fromEntries(addresses.filter(a => a !== OWNER).map(a => [a, decodeTokenAccount(accounts[a])])),
    nativeLamports: BigInt(accounts[OWNER].lamports), slot: observed.context.slot };
}
function inspectExtraInstructions(b, assetMint, direction, nativeInput, outputAta, wsolAta) {
  const allowedMints = new Set([USDC, SOL, assetMint]);
  for (const ix of [...b.setupInstructions, ...(b.cleanupInstruction ? [b.cleanupInstruction] : []), ...b.otherInstructions]) {
    const data = Buffer.from(ix.data, 'base64');
    if (ix.programId === ATA.toBase58()) {
      if (data.length > 1 || data.length === 1 && ![0, 1].includes(data[0]) || ix.accounts.length < 6 ||
          ix.accounts[0].pubkey !== OWNER || ix.accounts[2].pubkey !== OWNER || !allowedMints.has(ix.accounts[3].pubkey) ||
          ix.accounts[5].pubkey !== TOKEN || ![outputAta, wsolAta].includes(ix.accounts[1].pubkey)) throw Error('Unexpected associated account setup');
    } else if (ix.programId === TOKEN) {
      if (data.length !== 1 || ![9, 17].includes(data[0]) || ix.accounts[0]?.pubkey !== wsolAta ||
          data[0] === 9 && (ix.accounts[1]?.pubkey !== OWNER || ix.accounts[2]?.pubkey !== OWNER))
        throw Error('Unexpected token setup, delegation, or cleanup instruction');
    } else if (ix.programId === SYSTEM) {
      if (direction !== 'exit-sol' || data.length !== 12 || data.readUInt32LE(0) !== 2 ||
          ix.accounts[0]?.pubkey !== OWNER || ix.accounts[1]?.pubkey !== wsolAta || data.readBigUInt64LE(4) !== nativeInput)
        throw Error('Unexpected native transfer in swap setup');
    } else throw Error('Uninspected instruction outside the Jupiter swap');
  }
}
export function validateEffects({ before, after, inputAddress, outputAddress, outputMint, minimum, input, direction, fee, expectedNewRent, expectedRefund }) {
  const afterTokens = Object.fromEntries(before.addresses.filter(a => a !== OWNER).map(a => [a, decodeTokenAccount(after[a])]));
  if (after[OWNER]?.owner !== SYSTEM) throw Error('Simulation changed wallet authority');
  for (const address of before.addresses.filter(a => a !== OWNER)) {
    const pre = before.tokenAccounts[address], post = afterTokens[address];
    if (post && (post.owner !== OWNER || post.delegate !== null || post.delegatedAmount !== 0n || post.closeAuthority !== null || post.state !== 'initialized'))
      throw Error('Unsafe simulated token account authority or state');
    if (pre && post && pre.mint !== post.mint) throw Error('Token account mint changed');
    if (address !== inputAddress && address !== outputAddress && (pre?.amountAtomic ?? 0n) !== (post?.amountAtomic ?? 0n))
      throw Error('Swap changed an unrelated asset balance');
    if (pre && !post && address !== inputAddress) throw Error('Swap closed an unrelated account');
  }
  const beforeInput = before.tokenAccounts[inputAddress]?.amountAtomic ?? 0n;
  const afterInput = afterTokens[inputAddress]?.amountAtomic ?? 0n;
  const beforeOutput = before.tokenAccounts[outputAddress]?.amountAtomic ?? 0n;
  const afterOutput = afterTokens[outputAddress]?.amountAtomic ?? 0n;
  if (afterTokens[outputAddress]?.mint !== outputMint) throw Error('Unexpected output account mint');
  checkPortfolioSimulation({ direction, inputAtomic: input, minimumOutputAtomic: minimum, beforeInput, afterInput, beforeOutput, afterOutput,
    beforeSol: before.nativeLamports, afterSol: BigInt(after[OWNER].lamports), networkFeeLamports: fee,
    newOutputAtaRentLamports: expectedNewRent, verifiedInputAtaRefundLamports: expectedRefund });
  return { beforeInput, afterInput, beforeOutput, afterOutput, beforeSol: before.nativeLamports, afterSol: BigInt(after[OWNER].lamports),
    newOutputAtaRentLamports: expectedNewRent, verifiedInputAtaRefundLamports: expectedRefund, networkFeeLamports: fee };
}
export function checkLookupTable(account, expectedAddresses) {
  if (!account || account.owner !== 'AddressLookupTab1e1111111111111111111111111' || !Array.isArray(expectedAddresses))
    throw Error('Missing or invalid on-chain address lookup table');
  const state = AddressLookupTableAccount.deserialize(Buffer.from(account.data[0], 'base64'));
  if (state.deactivationSlot !== 0xffffffffffffffffn || expectedAddresses.some((address, i) => state.addresses[i]?.toBase58() !== address))
    throw Error('Jupiter lookup addresses differ from the active on-chain table');
}
export async function preparePortfolioTrade(symbol, direction = 'entry', spentByMint = {}) {
  const startedAt = Date.now();
  const asset = registry.assets.find(a => a.symbol === symbol);
  if (!asset || !['entry', 'exit', 'exit-sol'].includes(direction) || (direction === 'exit-sol') !== (symbol === 'SOL')) throw Error('Invalid asset or direction');
  const [assetAta, usdcAta, wsolAta] = await Promise.all([associated(asset.mint), associated(USDC), associated(SOL)]);
  const before = await snapshotWallet([assetAta, usdcAta, wsolAta]);
  const mintAccount = await rpc('getAccountInfo', [asset.mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const info = mintAccount.value?.data?.parsed?.info;
  if (!info) throw Error('Missing mint metadata');
  const liveMetadata = { mint: asset.mint, tokenProgram: mintAccount.value.owner, decimals: info.decimals,
    mintAuthority: info.mintAuthority, freezeAuthority: info.freezeAuthority, extensions: info.extensions ?? [], checkedAtMs: Date.now() };
  const holding = before.tokenAccounts[assetAta]?.amountAtomic ?? 0n;
  // Keep a reserve plus the maximum fee so an authorized SOL exit cannot spend its gas.
  const input = direction === 'entry' ? ENTRY_USDC_ATOMIC : direction === 'exit-sol' ? before.nativeLamports - MIN_GAS_LAMPORTS - 60_000n : holding;
  if (input <= 0n) throw Error('No permitted balance to trade');
  const inputMint = direction === 'entry' ? USDC : asset.mint;
  const outputMint = direction === 'entry' ? asset.mint : USDC;
  const inputAddress = direction === 'entry' ? usdcAta : direction === 'exit-sol' ? null : assetAta;
  const outputAddress = direction === 'entry' ? assetAta : usdcAta;
  const b = await requestBuild({ inputMint, outputMint, amount: input.toString(), taker: OWNER, slippageBps: '50', transactionVersion: '0' });
  const context = { nowMs: Date.now(), direction, holdingAtomic: holding, ownedNativeLamports: before.nativeLamports,
    sellableNativeLamports: input, spentByMint, liveMetadata, inputAccount: inputAddress ? before.tokenAccounts[inputAddress] : null,
    outputAccount: before.tokenAccounts[outputAddress] };
  const checked = checkPortfolioQuote(b, context);
  const encoded = await checkJupiterSwapInstruction(b, { inputAddress: inputAddress ?? wsolAta, outputAddress,
    ownedTokenAddresses: Object.entries(before.tokenAccounts).filter(([, account]) => account !== null).map(([address]) => address) });
  const tables = Object.entries(b.addressesByLookupTableAddress ?? {});
  if (tables.length) {
    const resolved = await rpc('getMultipleAccounts', [tables.map(([address]) => address), { encoding: 'base64', commitment: 'confirmed', minContextSlot: before.slot }]);
    tables.forEach(([, addresses], i) => checkLookupTable(resolved.value[i], addresses));
  }
  inspectExtraInstructions(b, asset.mint, direction, input, outputAddress, wsolAta);
  if (direction === 'exit') {
    if (before.tokenAccounts[assetAta]?.closeAuthority !== null) throw Error('Cannot recover input account rent');
    const close = new TransactionInstruction({ programId: new PublicKey(TOKEN), keys: [{ pubkey: new PublicKey(assetAta), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }], data: Buffer.from([9]) });
    b.otherInstructions.push({ programId: TOKEN, accounts: close.keys.map(k => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(close.data).toString('base64') });
  }
  const lifetime = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  b.blockhashWithMetadata = { blockhash: [...bs58.decode(lifetime.value.blockhash)], lastValidBlockHeight: lifetime.value.lastValidBlockHeight };
  const simulate = tx => rpc('simulateTransaction', [Buffer.from(tx.serialize()).toString('base64'), { encoding: 'base64', commitment: 'confirmed', sigVerify: false,
    replaceRecentBlockhash: false, minContextSlot: before.slot, accounts: { encoding: 'base64', addresses: before.addresses } }]);
  const first = await simulate(buildTransaction(b, 1_400_000, 0n));
  if (first.value.err || !Number.isSafeInteger(first.value.unitsConsumed) || first.value.unitsConsumed <= 0) throw Error('Initial simulation failed: ' + JSON.stringify(first.value.err));
  const units = Math.ceil(first.value.unitsConsumed * 1.2);
  if (units > 1_400_000) throw Error('Compute budget exceeds policy');
  const probe = buildTransaction(b, units, 0n);
  const estimate = await rpc('getPriorityFeeEstimate', [{ transaction: bs58.encode(probe.serialize()), options: { priorityLevel: 'Medium' } }]);
  const fee = boundedPriorityFee(estimate.priorityFeeEstimate, units);
  const tx = buildTransaction(b, units, fee.microLamports);
  const [final, networkFee, rent, height] = await Promise.all([simulate(tx),
    rpc('getFeeForMessage', [Buffer.from(tx.message.serialize()).toString('base64'), { commitment: 'confirmed' }]),
    rpc('getMinimumBalanceForRentExemption', [165]), rpc('getBlockHeight', [{ commitment: 'confirmed' }])]);
  if (final.value.err || !final.value.accounts || networkFee.value === null || final.context.slot < before.slot) throw Error('Final simulation failed or used a stale slot: ' + JSON.stringify(final.value.err));
  if (height + 15 >= b.blockhashWithMetadata.lastValidBlockHeight || Date.now() - startedAt > 15_000) throw Error('Preparation expired; no transaction signed');
  const after = Object.fromEntries(before.addresses.map((a, i) => [a, a === OWNER ? final.value.accounts[i] : normalizeClosedAccount(final.value.accounts[i])]));
  const newRent = direction === 'entry' && before.accounts[outputAddress] === null ? BigInt(rent) : 0n;
  if (newRent && BigInt(after[outputAddress]?.lamports ?? 0) !== newRent) throw Error('Unexpected output token account rent');
  if (before.accounts[wsolAta] !== null) throw Error('An existing WSOL account requires explicit rent reconciliation');
  const refund = direction === 'exit' ? BigInt(before.accounts[inputAddress].lamports) : 0n;
  if (direction === 'exit' && after[inputAddress] !== null) throw Error('Input account closure was not verified');
  const effects = validateEffects({ before, after, inputAddress, outputAddress, outputMint, minimum: encoded.minimumOutputAtomic, input, direction,
    fee: BigInt(networkFee.value), expectedNewRent: newRent, expectedRefund: refund });
  const report = { readOnly: true, executionAuthorized: false, observedAt: new Date().toISOString(), symbol, direction,
    inputMint, outputMint, inputAtomic: input.toString(), minimumOutputAtomic: encoded.minimumOutputAtomic.toString(), quoteMinimumOutputAtomic: checked.minimumOutputAtomic.toString(), outputAtomic: b.outAmount, encoded,
    route: b.routePlan.map(r => r.swapInfo.label), networkFeeLamports: networkFee.value, unitsLimit: units, unitsConsumed: final.value.unitsConsumed,
    priorityLamports: fee.lamports.toString(), recommendedMicroLamports: estimate.priorityFeeEstimate, selectedMicroLamports: fee.microLamports.toString(), effects, context, before, addresses: before.addresses, inputAddress, outputAddress,
    quote: b, originalBlockhash: tx.message.recentBlockhash, lastValidBlockHeight: lifetime.value.lastValidBlockHeight, simulationSlot: final.context.slot, startedAtMs: startedAt, preparationAgeMs: Date.now() - startedAt };
  const folder = path.join(stateDir, 'portfolio-preparations'); fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = path.join(folder, `${report.observedAt.replace(/[:.]/g, '-')}-${symbol}-${direction}.json`);
  fs.writeFileSync(file, json(report), { mode: 0o600, flag: 'wx' });
  return { tx, report, context, effects, file };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const prepared = await preparePortfolioTrade(process.argv[2], process.argv[3] ?? 'entry');
    const { before, context, quote, ...summary } = prepared.report;
    console.log(json(summary));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
