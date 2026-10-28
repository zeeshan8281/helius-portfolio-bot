import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monitorDecision, restoredStop, mayTryAnotherExit } from './portfolio-monitor.mjs';
import { OWNER } from './policy.mjs';

test('monitor uses whole-portfolio net estimates and applies the approved loss, target and deadline triggers', () => {
  const baseline = { bidMarkedUsdcAtomic: '1000000' }, mark = value => ({ bidMinimumMarkedUsdcAtomic: value, feeBudgetUsdcAtomic: '10000', confidence: 'quote-only', observedAt: '2030-01-01T00:00:00.000Z' });
  const authorization = { maxLossBps: 1000, targetBps: 500, authorizedUntilISO: '2030-01-02T00:00:00.000Z' };
  const now = Date.parse('2030-01-01T00:00:00.000Z');
  assert.equal(monitorDecision(baseline, mark('910000'), authorization, now).reason, 'loss-trigger');
  assert.equal(monitorDecision(baseline, mark('910001'), authorization, now).reason, 'hold');
  assert.equal(monitorDecision(baseline, mark('1059999'), authorization, now).reason, 'hold');
  assert.equal(monitorDecision(baseline, mark('1060000'), authorization, now).reason, 'estimated-target');
  assert.equal(monitorDecision(baseline, { ...mark('1000000'), observedAt: authorization.authorizedUntilISO }, authorization, Date.parse(authorization.authorizedUntilISO)).reason, 'time-limit');
  assert.throws(() => monitorDecision(baseline, { ...mark('1000000'), confidence: 'liquidation-unknown', feeBudgetUsdcAtomic: null }, authorization, now), /complete/);
  assert.throws(() => monitorDecision(baseline, mark('1000000'), authorization, now + 30_001), /Fresh/);
});
test('closing reasons survive an attention state and belong only to the approved run', () => {
  assert.equal(restoredStop({ state: 'attention-required', authorizationSha256: 'run', exitReason: 'time-limit' }, 'run'), 'time-limit');
  assert.equal(restoredStop({ state: 'positions-closed', authorizationSha256: 'run', exitReason: 'estimated-target' }, 'run'), 'estimated-target');
  assert.equal(restoredStop({ authorizationSha256: 'other', exitReason: 'loss-trigger' }, 'run'), null);
});
test('an exit preparation failure permits another asset only when every original intent is resolved safely', () => {
  const journal = { owner: OWNER, authorizationSha256: 'run', attempts: [{ state: 'finalized-and-reconciled' }, { state: 'expired-unspent' }] };
  assert.equal(mayTryAnotherExit(journal, 'run'), true);
  for (const state of ['signed-before-send', 'unresolved', 'failed-on-chain', 'unknown'])
    assert.equal(mayTryAnotherExit({ ...journal, attempts: [...journal.attempts, { state }] }, 'run'), false);
  assert.equal(mayTryAnotherExit(journal, 'other'), false);
  assert.equal(mayTryAnotherExit(null, 'run'), false);
});
