import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkJupiterSwapInstruction, verifyJupiterSwapInstruction } from './portfolio-jupiter-decode.mjs';
import { OWNER, USDC } from './policy.mjs';

const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const EVENT = 'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf';
const inputAddress = 'BAEseSTrwyTuX6CytNv8mob9y1Ab3YUdMWTmakWd1f46';
// Actual unsigned /swap/v2/build responses captured2026-10-28; remaining DEX accounts omitted because these tests bind the fixed router accounts.
const samples = [
  { symbol: 'ETH', mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', output: '27656', minimum: '27518', destination: 'GN92xLtBP7XwRkNtN91iFXeMrv6Rka9CtNkdDX5jC3mK', data: 'u2T6zDHErxQQ6wkAAAAAAAhsAAAAAAAAMgAAAAAAAQAAAJcBECcAAQ==', venue: 'GoonFiV3' },
  { symbol: 'HYPE', mint: '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g', output: '7997209', minimum: '7957223', destination: '7P5xHuwXqjo8e5bYe7jiTmLgNSED2CPeixjBPuugiGUT', data: 'u2T6zDHErxQQ6wkAAAAAABkHegAAAAAAMgAAAAAAAQAAAJcBECcAAQ==', venue: 'GoonFiV3' },
  { symbol: 'ZEC', mint: 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS', output: '49497', minimum: '49250', destination: 'DKcLLGV9wbnhg3YgCyStqQMmDJEXzHgdpk3fxb97mAbv', data: 'u2T6zDHErxQQ6wkAAAAAAFnBAAAAAAAAMgAAAAAAAQAAAJwQJwAB', venue: 'ByrealDynamicV3' },
];
function build(sample = samples[0]) {
  return { inputMint: USDC, outputMint: sample.mint, inAmount: '650000', outAmount: sample.output, otherAmountThreshold: sample.minimum,
    swapMode: 'ExactIn', transactionVersion: 0, slippageBps: 50, swapInstruction: { programId: JUPITER, data: sample.data,
      accounts: [OWNER, inputAddress, sample.destination, USDC, sample.mint, TOKEN, TOKEN, JUPITER, EVENT, JUPITER]
        .map((pubkey, i) => ({ pubkey, isSigner: i === 0, isWritable: i === 1 || i === 2 })) } };
}
const check = (b, sample = samples[0]) => checkJupiterSwapInstruction(b, { inputAddress, outputAddress: sample.destination });
function mutateData(b, mutate) {
  const bytes = Buffer.from(b.swapInstruction.data, 'base64'); mutate(bytes); b.swapInstruction.data = bytes.toString('base64'); return b;
}

test('captured real unsigned builds bind embedded exact-in amounts, mints, accounts, fees and slippage', () => {
  for (const sample of samples) {
    const decoded = check(build(sample), sample);
    assert.equal(decoded.inAmount, 650_000n);
    assert.equal(decoded.quotedOutAmount, BigInt(sample.output));
    assert.equal(decoded.quoteMinimumOutputAtomic, BigInt(sample.minimum));
    assert.equal(decoded.minimumOutputAtomic, BigInt(sample.minimum) - 1n);
    assert.equal(decoded.venue, sample.venue);
    assert.equal(decoded.platformFeeBps, 0);
    assert.equal(decoded.positiveSlippageBps, 0);
  }
});

test('changing encoded amounts, weakening slippage or adding either fee cannot hide behind safe JSON', () => {
  for (const mutate of [b => b.writeBigUInt64LE(650_001n, 8), b => b.writeBigUInt64LE(1n, 16), b => b.writeUInt16LE(51, 24), b => b.writeUInt16LE(1, 26), b => b.writeUInt16LE(1, 28)])
    assert.throws(() => check(mutateData(build(), mutate)), /Encoded Jupiter/);
  for (const overrides of [{ inAmount: '0650000' }, { inAmount: 650000 }, { outAmount: '18446744073709551616' }, { otherAmountThreshold: '1' }, { otherAmountThreshold: '27517' }, { swapMode: 'ExactOut' }, { transactionVersion: 1 }, { slippageBps: 51 }])
    assert.throws(() => check({ ...build(), ...overrides }));
});

test('unknown, malformed, unallocated or trailing route data fails closed', () => {
  for (const mutate of [b => b[0] ^= 1, b => b.writeUInt32LE(0, 30), b => b.writeUInt32LE(2, 30), b => b[34] = 255,
    b => b[35] = 2, b => b.writeUInt16LE(9999, 36), b => b[38] = 1, b => b[39] = 0])
    assert.throws(() => check(mutateData(build(), mutate)), /Unsupported/);
  for (const data of [samples[0].data.slice(0, -4), samples[0].data + '\n', Buffer.concat([Buffer.from(samples[0].data, 'base64'), Buffer.from([0])]).toString('base64')])
    assert.throws(() => check({ ...build(), swapInstruction: { ...build().swapInstruction, data } }), /Unsupported/);
  const shared = mutateData(build(), b => Buffer.from('d19853937cfed8e9', 'hex').copy(b));
  assert.throws(() => check(shared), /Shared|Unsupported/);
});

function step(variantPayload, bps = 10_000, inputIndex = 0, outputIndex = 1) {
  const tail = Buffer.alloc(4); tail.writeUInt16LE(bps); tail[2] = inputIndex; tail[3] = outputIndex;
  return Buffer.concat([Buffer.from(variantPayload), tail]);
}
function withPlan(steps) {
  const b = build(), count = Buffer.alloc(4); count.writeUInt32LE(steps.length);
  b.swapInstruction.data = Buffer.concat([Buffer.from(b.swapInstruction.data, 'base64').subarray(0, 30), count, ...steps]).toString('base64');
  return b;
}

test('official IDL variants with option/vector payloads and split/multihop allocations decode fully', () => {
  assert.equal(check(withPlan([step([17, 1])])).venue, 'Whirlpool');
  assert.equal(check(withPlan([step([47, 1, 1, 1, 0, 0, 0, 0, 2])])).venue, 'WhirlpoolSwapV2');
  const split = check(withPlan([step([17, 1], 5000), step([156], 5000)]));
  assert.equal(split.routePlan.length, 2);
  const multi = check(withPlan([step([17, 1]), step([151, 0], 10_000, 1, 2)]));
  assert.equal(multi.routePlan[1].inputIndex, 1);
  const firstBps = Buffer.alloc(4), secondBps = Buffer.alloc(4); firstBps.writeUInt32LE(6000); secondBps.writeUInt32LE(4000);
  const dynamic = Buffer.concat([Buffer.from([146, 2, 0, 0, 0, 5, 1]), firstBps, Buffer.from([6]), secondBps, Buffer.from([3, 2])]);
  assert.equal(check(withPlan([step(dynamic)])).venue, 'DynamicV2');
});

test('nested unknown enums, invalid options, excessive vectors, partial fills and invalid route flow fail closed', () => {
  for (const plan of [[step([47, 1, 2])], [step([146, 65, 0, 0, 0])], [step([146, 1, 0, 0, 0, 255])],
    [step([187, 0, 1])], [step([17, 1], 10_000, 1, 2)], [step([17, 1], 5000)], [step([17, 1]), step([156])]])
    assert.throws(() => check(withPlan(plan)), /Unsupported/);
  const huge = build(); huge.swapInstruction.data = Buffer.alloc(4097).toString('base64'); assert.throws(() => check(huge));
});

test('supplied wallet token accounts cannot be writable unless they are the checked input or output', () => {
  const owned = '7P5xHuwXqjo8e5bYe7jiTmLgNSED2CPeixjBPuugiGUT';
  const b = build(); b.swapInstruction.accounts.push({ pubkey: owned, isSigner: false, isWritable: true });
  assert.throws(() => checkJupiterSwapInstruction(b, { inputAddress, outputAddress: samples[0].destination, ownedTokenAddresses: [owned] }));
  b.swapInstruction.accounts.at(-1).isWritable = false;
  const decoded = checkJupiterSwapInstruction(b, { inputAddress, outputAddress: samples[0].destination, ownedTokenAddresses: new Set([owned, inputAddress, samples[0].destination]) });
  assert.equal(decoded.unrelatedAccountCheckPerformed, true);
  assert.equal(check(build()).unrelatedAccountCheckPerformed, false);
  assert.throws(() => checkJupiterSwapInstruction(b, { inputAddress, outputAddress: samples[0].destination, ownedTokenAddresses: 'bad' }));
});

test('source, destination, mints, owner, program, token program and account permissions are all bound', () => {
  for (let i = 0; i < 10; i++) {
    const b = build(); b.swapInstruction.accounts[i].pubkey = '11111111111111111111111111111111';
    assert.throws(() => check(b), /authority, mint, token program or destination/);
    const signer = build(); signer.swapInstruction.accounts[i].isSigner = !signer.swapInstruction.accounts[i].isSigner;
    assert.throws(() => check(signer));
    const writable = build(); writable.swapInstruction.accounts[i].isWritable = !writable.swapInstruction.accounts[i].isWritable;
    assert.throws(() => check(writable));
  }
  const b = build(); b.swapInstruction.programId = TOKEN; assert.throws(() => check(b));
  const extra = build(); extra.swapInstruction.accounts.push({ pubkey: TOKEN, isSigner: true, isWritable: false }); assert.throws(() => check(extra));
  assert.throws(() => checkJupiterSwapInstruction(build(), { inputAddress: null, outputAddress: samples[0].destination }));
  assert.throws(() => checkJupiterSwapInstruction(build(), { inputAddress, outputAddress: inputAddress }));
});

test('the same official exact-in layout binds a token exit as well as an entry', () => {
  const exit = build(); exit.inputMint = samples[0].mint; exit.outputMint = USDC;
  [exit.swapInstruction.accounts[1].pubkey, exit.swapInstruction.accounts[2].pubkey] = [samples[0].destination, inputAddress];
  [exit.swapInstruction.accounts[3].pubkey, exit.swapInstruction.accounts[4].pubkey] = [samples[0].mint, USDC];
  assert.doesNotThrow(() => checkJupiterSwapInstruction(exit, { inputAddress: samples[0].destination, outputAddress: inputAddress }));
});

function sharedBuild() {
  const b = build(samples[1]);
  b.outAmount = '7952772'; b.otherAmountThreshold = '7913009';
  b.swapInstruction.data = Buffer.from('d19853937cfed8e90710eb0900000000008459790000000000320000000000030000001a69130003b200a71300022610270203', 'hex').toString('base64');
  b.swapInstruction.accounts = ['6LXutJvKUw8Q5ue2gCgKHQdAN4suWW8awzFVC6XCguFx', OWNER, inputAddress,
    'G4CD7aqqZZ6QKCNHrc1MPdS9Aw8BWmQ5ZkDd54W6mAEG', 'G9qMmNd6jq2ZANu5ULSrFPfmZEWfdT9VYhsuiEuTNiFa', samples[1].destination,
    USDC, samples[1].mint, TOKEN, TOKEN, EVENT, JUPITER]
    .map((pubkey, i) => ({ pubkey, isSigner: i === 1, isWritable: [2, 3, 4, 5].includes(i) }));
  return b;
}

test('captured shared HYPE split/multihop route independently derives the official authority and both program ATAs', async () => {
  const decoded = await verifyJupiterSwapInstruction(sharedBuild(), { inputAddress, outputAddress: samples[1].destination, ownedTokenAddresses: [inputAddress] });
  assert.equal(decoded.instruction, 'shared_accounts_route_v2');
  assert.equal(decoded.sharedAuthorityId, 7);
  assert.deepEqual(decoded.routePlan.map(r => r.venue), ['RaydiumClmm', 'TesseraVV2', 'MeteoraDlmm']);
  assert.equal(decoded.inAmount, 650_000n);
  assert.equal(decoded.minimumOutputAtomic, 7_913_008n);
  assert.equal(decoded.quoteMinimumOutputAtomic, 7_913_009n);
});

test('shared route cannot substitute an authority, either program ATA, user account, mint, signer or fee', async () => {
  const context = { inputAddress, outputAddress: samples[1].destination };
  assert.throws(() => checkJupiterSwapInstruction(sharedBuild(), context), /independent PDA/);
  for (let i = 0; i < 12; i++) {
    const b = sharedBuild(); b.swapInstruction.accounts[i].pubkey = '11111111111111111111111111111111';
    await assert.rejects(() => verifyJupiterSwapInstruction(b, context), /authority, mint, token program or destination/);
  }
  for (const mutate of [b => b[8] = 6, b => b[8] = 16, b => b.writeBigUInt64LE(1n, 9), b => b.writeUInt16LE(1, 27)])
    await assert.rejects(() => verifyJupiterSwapInstruction(mutateData(sharedBuild(), mutate), context));
  const fake = sharedBuild(); fake.swapInstruction.accounts[0].pubkey = OWNER;
  await assert.rejects(() => verifyJupiterSwapInstruction(fake, { ...context, sharedAccounts: { id: 7, programAuthority: OWNER } }));
});
