import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { decodeTokenAccount, checkLookupTable, boundedPriorityFee, normalizeClosedAccount } from './portfolio-prepare.mjs';
import { entryReservations, checkJournal, checkEntryRisk, sameWallet } from './portfolio-run.mjs';
import { OWNER, USDC, SOL } from './policy.mjs';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
test('only a zero-lamport empty system tombstone is normalized as a closed account', () => {
  const tombstone = { owner: '11111111111111111111111111111111', lamports: 0, executable: false, data: ['', 'base64'] };
  assert.equal(normalizeClosedAccount(tombstone), null);
  for (const changed of [{ lamports: 1 }, { owner: TOKEN }, { executable: true }, { data: ['AA==', 'base64'] }]) {
    const account = { ...tombstone, ...changed }; assert.equal(normalizeClosedAccount(account), account);
  }
});
test('advisory priority fees cannot increase the cap, even at the rounding boundary', () => {
  assert.equal(boundedPriorityFee(999_999_999, 123_457).lamports, 50_000n);
  assert.equal(boundedPriorityFee(1.1, 123_457).microLamports, 2n);
  for (const invalid of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => boundedPriorityFee(invalid, 1));
  for (const invalid of [0, -1, 1.5]) assert.throws(() => boundedPriorityFee(1, invalid));
});
test('classic account decoder preserves authorities and rejects extensions or malformed options', () => {
  const bytes = Buffer.alloc(165);
  Buffer.from(new PublicKey(USDC).toBytes()).copy(bytes, 0);
  Buffer.from(new PublicKey(OWNER).toBytes()).copy(bytes, 32);
  bytes.writeBigUInt64LE(9_007_199_254_740_993n, 64); bytes[108] = 1;
  const account = () => ({ owner: TOKEN, data: [bytes.toString('base64'), 'base64'], lamports: 1_488_440 });
  assert.equal(decodeTokenAccount(account()).amountAtomic, 9_007_199_254_740_993n);
  assert.equal(decodeTokenAccount(account()).owner, OWNER);
  bytes.writeUInt32LE(1, 72); Buffer.from(new PublicKey(SOL).toBytes()).copy(bytes, 76);
  bytes.writeBigUInt64LE(12n, 121);
  assert.equal(decodeTokenAccount(account()).delegate, SOL);
  assert.equal(decodeTokenAccount(account()).delegatedAmount, 12n);
  bytes.writeUInt32LE(2, 129);
  assert.throws(() => decodeTokenAccount(account()), /authority flags/);
  assert.throws(() => decodeTokenAccount({ ...account(), owner: OWNER }), /classic/);
  assert.throws(() => decodeTokenAccount({ ...account(), data: [Buffer.alloc(166).toString('base64'), 'base64'] }), /classic/);
});

test('lookup addresses must match on-chain indexes and an active lookup table', () => {
  const bytes = Buffer.alloc(56 + 64); bytes.writeUInt32LE(1, 0); bytes.writeBigUInt64LE(0xffffffffffffffffn, 4);
  Buffer.from(new PublicKey(USDC).toBytes()).copy(bytes, 56); Buffer.from(new PublicKey(SOL).toBytes()).copy(bytes, 88);
  const account = () => ({ owner: 'AddressLookupTab1e1111111111111111111111111', data: [bytes.toString('base64'), 'base64'] });
  assert.doesNotThrow(() => checkLookupTable(account(), [USDC, SOL]));
  assert.throws(() => checkLookupTable(account(), [SOL, USDC]), /differ/);
  assert.throws(() => checkLookupTable(null, [USDC]), /Missing/);
  bytes.writeBigUInt64LE(1n, 4);
  assert.throws(() => checkLookupTable(account(), [USDC, SOL]), /active/);
});

test('pending and failed entry intents reserve budget; proven unspent expiry alone releases it', () => {
  const attempt = state => ({ state, report: { direction: 'entry', outputMint: USDC, inputAtomic: '650000' } });
  assert.equal(entryReservations([attempt('signed-before-send'), attempt('unresolved')])[USDC], 1_300_000n);
  assert.equal(entryReservations([attempt('failed-on-chain')])[USDC], 650_000n);
  assert.deepEqual(entryReservations([attempt('expired-unspent')]), {});
  const journal = { owner: OWNER, authorizationSha256: 'hash', attempts: [attempt('unresolved')] };
  assert.throws(() => checkJournal(journal, 'hash'), /unresolved/);
  journal.attempts[0].state = 'failed-on-chain';
  assert.throws(() => checkJournal(journal, 'hash'), /failed/);
  journal.attempts[0].state = 'finalized-and-reconciled';
  assert.doesNotThrow(() => checkJournal(journal, 'hash'));
  assert.throws(() => checkJournal(journal, 'other'), /approved/);
});

test('portfolio risk gates include estimated exit costs and stop new entries at exact boundaries', () => {
  const baseline = { owner: OWNER, confidence: 'quote-only', bidMarkedUsdcAtomic: '1000000' };
  const mark = value => ({ owner: OWNER, confidence: 'quote-only', observedAt: new Date().toISOString(), bidMinimumMarkedUsdcAtomic: value, feeBudgetUsdcAtomic: '10000' });
  const authorization = { maxLossBps: 500, targetBps: 500 };
  assert.throws(() => checkEntryRisk(baseline, mark('960000'), authorization), /loss/);
  assert.doesNotThrow(() => checkEntryRisk(baseline, mark('960001'), authorization));
  assert.doesNotThrow(() => checkEntryRisk(baseline, mark('1059999'), authorization));
  assert.throws(() => checkEntryRisk(baseline, mark('1060000'), authorization), /target/);
  assert.throws(() => checkEntryRisk(baseline, { ...mark('1000000'), observedAt: '2000-01-01T00:00:00.000Z' }, authorization), /Fresh/);
});

test('a deposit, authority change, or token-account change cannot silently match a run inventory', () => {
  const wallet = { addresses: [OWNER, USDC], nativeLamports: 10n, tokenAccounts: { [USDC]: { amountAtomic: 20n, owner: OWNER, mint: USDC, delegate: null, delegatedAmount: 0n, closeAuthority: null, state: 'initialized' } }, accounts: { [USDC]: { lamports: 5 } } };
  const before = JSON.parse(JSON.stringify(wallet, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  assert.equal(sameWallet(wallet, before), true);
  assert.equal(sameWallet({ ...wallet, nativeLamports: 11n }, before), false);
  assert.equal(sameWallet({ ...wallet, tokenAccounts: { [USDC]: { ...wallet.tokenAccounts[USDC], amountAtomic: 21n } } }, before), false);
  assert.equal(sameWallet({ ...wallet, tokenAccounts: { [USDC]: { ...wallet.tokenAccounts[USDC], delegate: OWNER } } }, before), false);
  assert.equal(sameWallet({ ...wallet, accounts: { [USDC]: { lamports: 6 } } }, before), false);
});
