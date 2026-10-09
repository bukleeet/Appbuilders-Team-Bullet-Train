import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionItems, countOpenTasks, deleteTask, todayStart, progress, canUndo, reason } from '../src/planner-ui.js';
import { acceptPlan, undoPlan } from '../src/store.js';
import { planWeek } from '../src/scheduler.js';
import { createAppState, createTask, createCommitment, createWindow, validateAppState } from '../src/model.js';

// Saturday 2026-10-10 in Manila. 09:00 Manila = 01:00Z.
const ORIGIN = Date.parse('2026-10-09T16:00:00Z');
const fixture = () => createAppState({
  tasks: [createTask({ id: 'essay', title: 'Essay', course: 'HIST', dueAt: '2026-10-12T15:59:00Z', remainingMinutes: 200, steps: ['Outline'] })],
  commitments: [createCommitment({ id: 'class', title: 'Class', startAt: '2026-10-11T02:00:00Z', endAt: '2026-10-11T03:30:00Z' })],
  availability: [createWindow({ id: 'w', startAt: '2026-10-10T01:00:00Z', endAt: '2026-10-10T05:00:00Z' })],
  blocks: [
    { id: 'session', taskId: 'essay', startAt: '2026-10-10T01:00:00Z', endAt: '2026-10-10T03:00:00Z', locked: false, status: 'planned', completedMinutes: 0 },
    { id: 'second', taskId: 'essay', startAt: '2026-10-11T05:00:00Z', endAt: '2026-10-11T06:00:00Z', locked: false, status: 'planned', completedMinutes: 0 },
  ],
});

test('todayStart is Manila midnight for any instant that day', () => {
  assert.equal(todayStart(new Date('2026-10-10T15:59:00Z')), ORIGIN);
  assert.equal(todayStart(new Date('2026-10-09T16:00:00Z')), ORIGIN);
});

test('sessions combine commitments and blocks with Manila day and time', () => {
  const items = sessionItems(fixture(), ORIGIN);
  assert.deepEqual(items.map(i => [i.id, i.day, i.time, i.kind ?? 'study']), [
    ['session', 0, '09:00', 'study'],
    ['class', 1, '10:00', 'fixed'],
    ['second', 1, '13:00', 'study'],
  ]);
  const study = items.find(i => i.id === 'session');
  assert.equal(study.taskId, 'essay');
  assert.equal(study.sessionMinutes, 120);
  assert.equal(study.minutes, 200);
  assert.equal(study.dueDay, 2);
  assert.equal(study.step, 'Outline');
  assert.equal(countOpenTasks(items), 1);
});

test('session days do not depend on the machine timezone', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const [first] = sessionItems(fixture(), ORIGIN);
    assert.equal(first.day, 0);
    assert.equal(first.time, '09:00');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('blocks for a missing task are hidden and block statuses map to view statuses', () => {
  const state = fixture();
  state.blocks[0].status = 'completed';
  state.blocks[1].status = 'partially_completed';
  state.blocks.push({ ...state.blocks[0], id: 'orphan', taskId: 'gone' });
  const items = sessionItems(state, ORIGIN);
  assert.deepEqual(items.filter(i => i.kind !== 'fixed').map(i => [i.id, i.status]), [['session', 'done'], ['second', 'partial']]);
});

test('deleting a task removes its sessions and every undo snapshot of it', () => {
  const state = fixture();
  acceptPlan(state, planWeek(state, { now: '2026-10-10T00:00:00Z' }), 'plan');
  deleteTask(state, 'essay');
  assert.deepEqual(state.tasks, []);
  assert.deepEqual(state.blocks, []);
  undoPlan(state);
  assert.deepEqual(state.tasks, []);
  assert.deepEqual(state.blocks, []);
  assert.equal(validateAppState(state).valid, true);
});

test('recording progress clears unsafe plan undo history', () => {
  const state = fixture();
  acceptPlan(state, planWeek(state, { now: '2026-10-10T00:00:00Z' }), 'plan');
  assert.equal(canUndo(state), true);
  progress(state, { blockId: state.blocks[0].id, completedMinutes: 30 });
  assert.equal(state.tasks[0].remainingMinutes, 170);
  assert.equal(state.history.length, 0);
  assert.equal(canUndo(state), false);
  assert.equal(validateAppState(state).valid, true);
});

test('reason codes have student-facing text and unknown codes pass through', () => {
  assert.equal(reason('CONFLICTS_COMMITMENT'), 'Overlaps a fixed commitment');
  assert.equal(reason('NO_CAPACITY_BEFORE_DEADLINE'), 'Not enough study time before the deadline');
  assert.equal(reason('SOMETHING_NEW'), 'SOMETHING_NEW');
});
