import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,
  DEFAULT_TIMEZONE,
  TASK_STATUS,
  BLOCK_STATUS,
  generateId,
  createAppState,
  createTask,
  createCommitment,
  createWindow,
  createStudyBlock,
  createTaskDraft,
  createPlanProposal,
  validateInterval,
  validateTask,
  validateStudyBlock,
  validateCommitment,
  validateWindow,
  validateAppState,
  validatePlanProposal
} from '../src/model.js';

test('model.js: stable string ID generation', () => {
  const id1 = generateId('task');
  const id2 = generateId('task');
  assert.equal(typeof id1, 'string');
  assert.match(id1, /^task_/);
  assert.notEqual(id1, id2);
});

test('model.js: factory functions produce valid contract entities', () => {
  const state = createAppState();
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.timezone, DEFAULT_TIMEZONE);
  assert.deepEqual(state.tasks, []);
  assert.deepEqual(state.commitments, []);
  assert.deepEqual(state.availability, []);
  assert.deepEqual(state.blocks, []);
  assert.deepEqual(state.history, []);

  const task = createTask({
    title: 'Study Physics',
    course: 'PHYS 101',
    dueAt: '2026-10-15T12:00:00.000Z',
    remainingMinutes: 120
  });
  assert.equal(typeof task.id, 'string');
  assert.equal(task.title, 'Study Physics');
  assert.equal(task.course, 'PHYS 101');
  assert.equal(task.status, 'open');
  assert.equal(task.remainingMinutes, 120);

  const block = createStudyBlock({
    taskId: task.id,
    startAt: '2026-10-12T02:00:00.000Z',
    endAt: '2026-10-12T04:00:00.000Z'
  });
  assert.equal(block.taskId, task.id);
  assert.equal(block.locked, false);
  assert.equal(block.status, BLOCK_STATUS.PLANNED);
  assert.equal(block.completedMinutes, 0);

  const commitment = createCommitment({
    title: 'Lecture',
    startAt: '2026-10-12T00:00:00.000Z',
    endAt: '2026-10-12T01:30:00.000Z'
  });
  assert.equal(commitment.title, 'Lecture');

  const win = createWindow({
    startAt: '2026-10-12T00:00:00.000Z',
    endAt: '2026-10-12T12:00:00.000Z'
  });
  assert.equal(typeof win.id, 'string');

  const draft = createTaskDraft({
    title: 'Math Set',
    course: 'MATH 54',
    estimatedMinutes: 90,
    missingFields: ['dueAt']
  });
  assert.equal(draft.title, 'Math Set');
  assert.deepEqual(draft.missingFields, ['dueAt']);

  const proposal = createPlanProposal({
    blocks: [block],
    changes: [{ type: 'add', blockId: block.id, taskId: task.id, before: null, after: block, reason: 'New assignment' }]
  });
  assert.equal(proposal.blocks.length, 1);
  assert.equal(proposal.changes.length, 1);
});

test('model.js: validateInterval enforces [startAt, endAt) half-open start < end', () => {
  const valid = validateInterval('2026-10-10T02:00:00.000Z', '2026-10-10T03:00:00.000Z');
  assert.equal(valid.valid, true);

  const equal = validateInterval('2026-10-10T02:00:00.000Z', '2026-10-10T02:00:00.000Z');
  assert.equal(equal.valid, false);

  const reversed = validateInterval('2026-10-10T03:00:00.000Z', '2026-10-10T02:00:00.000Z');
  assert.equal(reversed.valid, false);

  const invalidDate = validateInterval('not-a-date', '2026-10-10T02:00:00.000Z');
  assert.equal(invalidDate.valid, false);
});

test('model.js: validateAppState strictly checks schemaVersion 2 and contract types', () => {
  const goodState = createAppState();
  const res = validateAppState(goodState);
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);

  // Reject unsupported schemaVersion
  const badVersion = { ...goodState, schemaVersion: 1 };
  const resBadVer = validateAppState(badVersion);
  assert.equal(resBadVer.valid, false);
  assert.match(resBadVer.errors[0], /Unsupported schemaVersion/);

  // Reject invalid task inside tasks array
  const badTaskState = createAppState({
    tasks: [{ id: 't1', title: 'test', course: 'C', dueAt: null, remainingMinutes: -10, status: 'unknown', steps: 'not-array', sourceText: 123 }]
  });
  const resBadTask = validateAppState(badTaskState);
  assert.equal(resBadTask.valid, false);
  assert.ok(resBadTask.errors.length >= 3);
});
