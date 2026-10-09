import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoFixtures } from '../src/fixtures.js';
import { planWeek } from '../src/scheduler.js';
import { acceptPlan, undoPlan } from '../src/store.js';
import { validateAppState as validate } from '../src/model.js';

test('planWeek proposal is accepted by the store, stays valid, and undoes cleanly', () => {
  const state = createDemoFixtures();
  const before = structuredClone(state.blocks);
  const proposal = planWeek(state, { now: new Date().toISOString() });
  acceptPlan(state, proposal, 'plan');
  assert.deepEqual(state.blocks, proposal.blocks);
  assert.equal(validate(state).valid, true);
  undoPlan(state);
  assert.deepEqual(state.blocks, before);
});
