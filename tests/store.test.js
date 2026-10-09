import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY_V2,
  STORAGE_KEY_V1,
  STORAGE_KEY_V1_BACKUP,
  STORAGE_KEY_CORRUPT_PREFIX,
  StorageError,
  ValidationError,
  loadState,
  saveState,
  exportState,
  importState,
  acceptPlan,
  undoPlan,
  recordProgress,
  loadDemoFixtures,
  migrateV1
} from '../src/store.js';
import {
  createAppState,
  createTask,
  createStudyBlock,
  createPlanProposal,
  TASK_STATUS,
  BLOCK_STATUS,
  validateAppState
} from '../src/model.js';

// Helper mock storage implementation for isolated test cases
function createMockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); }
  };
}

test('store.js: validated round-trip persistence', () => {
  const storage = createMockStorage();
  const state = createAppState({
    tasks: [
      createTask({ id: 't1', title: 'Calculus Assignment', course: 'MATH 54', remainingMinutes: 90 })
    ],
    blocks: [
      createStudyBlock({ id: 'b1', taskId: 't1', startAt: '2026-10-15T06:00:00.000Z', endAt: '2026-10-15T07:30:00.000Z' })
    ]
  });

  const saveRes = saveState(state, storage);
  assert.equal(saveRes.success, true);

  const loaded = loadState(storage);
  assert.equal(loaded.schemaVersion, 2);
  assert.equal(loaded.tasks.length, 1);
  assert.equal(loaded.tasks[0].title, 'Calculus Assignment');
  assert.equal(loaded.blocks.length, 1);
  assert.equal(loaded.blocks[0].id, 'b1');
});

test('store.js: quota-error handling surfaces StorageError without crashing', () => {
  const quotaStorage = {
    getItem() { return null; },
    setItem() {
      const err = new Error('Quota exceeded');
      err.name = 'QuotaExceededError';
      err.code = 22;
      throw err;
    },
    removeItem() {}
  };

  const state = createAppState();
  assert.throws(
    () => saveState(state, quotaStorage),
    (err) => {
      assert.ok(err instanceof StorageError);
      assert.equal(err.isQuotaExceeded, true);
      assert.ok(typeof err.metadata.recoverableData === 'string');
      return true;
    }
  );
});

test('store.js: migration from v1 creates backup and converts to stable schemaVersion 2', () => {
  const rawV1Data = JSON.stringify({
    tasks: [
      { id: 'math', title: 'Problem Set 4', course: 'MATH 54', minutes: 120, day: 1, dueDay: 4, time: '14:00', status: 'planned' },
      { id: 'history', title: 'Essay', course: 'KAS 1', minutes: 60, day: 2, time: '10:00', status: 'done' }
    ],
    previous: null
  });

  const storage = createMockStorage({
    [STORAGE_KEY_V1]: rawV1Data
  });

  // Verify v2 is absent initially
  assert.equal(storage.getItem(STORAGE_KEY_V2), null);

  const migrated = loadState(storage);

  // 1. Untouched v1 backup must be stored in STORAGE_KEY_V1_BACKUP
  assert.equal(storage.getItem(STORAGE_KEY_V1_BACKUP), rawV1Data);

  // 2. Schema upgraded to v2
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.tasks.length, 2);

  // Task 1: open with 120 remainingMinutes and stable ISO dueAt
  const t1 = migrated.tasks.find(t => t.id === 'math');
  assert.equal(t1.status, 'open');
  assert.equal(t1.remainingMinutes, 120);
  assert.ok(t1.dueAt.endsWith('Z'));
  assert.notEqual(t1.dueAt, migrated.blocks.find(b => b.taskId === 'math').startAt);

  // Task 2: was done, so remainingMinutes is 0
  const t2 = migrated.tasks.find(t => t.id === 'history');
  assert.equal(t2.status, 'done');
  assert.equal(t2.remainingMinutes, 0);

  // Study blocks created
  assert.equal(migrated.blocks.length, 2);

  // v2 is now persisted in storage
  assert.ok(storage.getItem(STORAGE_KEY_V2) !== null);
});

test('store.js: corrupt data preservation archives raw payload without data loss', () => {
  const corruptPayload = '{"schemaVersion": 2, "tasks": [BROKEN JSON';
  const storage = createMockStorage({
    [STORAGE_KEY_V2]: corruptPayload
  });

  const state = loadState(storage);

  // Fallback to clean AppState
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.tasks.length, 0);

  // Corrupt string must be preserved under a weekback-corrupt- key
  const corruptKeys = Array.from(storage.map.keys()).filter(k => k.startsWith(STORAGE_KEY_CORRUPT_PREFIX));
  assert.equal(corruptKeys.length, 1);
  assert.equal(storage.getItem(corruptKeys[0]), corruptPayload);
});

test('store.js: import/export validation rejects invalid data without overwriting', () => {
  const storage = createMockStorage();
  const validState = createAppState({
    tasks: [createTask({ id: 't_exp', title: 'Export Task', remainingMinutes: 45 })]
  });
  saveState(validState, storage);

  // 1. Export produces valid formatted JSON
  const exported = exportState(validState);
  assert.match(exported, /"schemaVersion": 2/);
  assert.match(exported, /Export Task/);

  // 2. Reject malformed JSON import
  assert.throws(() => importState('NOT JSON', storage), ValidationError);
  // Storage was NOT overwritten
  assert.equal(loadState(storage).tasks[0].title, 'Export Task');

  // 3. Reject invalid schema version import without overwriting
  const badVerJson = JSON.stringify({ schemaVersion: 99, tasks: [] });
  assert.throws(() => importState(badVerJson, storage), /Unsupported schemaVersion/);
  assert.equal(loadState(storage).tasks[0].title, 'Export Task');

  // 4. Valid import updates state
  const newImportState = createAppState({
    tasks: [createTask({ id: 't_imp', title: 'Imported Success', remainingMinutes: 30 })]
  });
  const res = importState(JSON.stringify(newImportState), storage);
  assert.equal(res.success, true);
  assert.equal(loadState(storage).tasks[0].title, 'Imported Success');
});

test('store.js: plan acceptance and atomic undo', () => {
  const initialTask = createTask({ id: 't1', title: 'Read Chapter 4', remainingMinutes: 60 });
  const initialBlock = createStudyBlock({
    id: 'b1',
    taskId: 't1',
    startAt: '2026-10-15T06:00:00.000Z',
    endAt: '2026-10-15T07:00:00.000Z'
  });

  const state = createAppState({
    tasks: [initialTask],
    blocks: [initialBlock]
  });

  const movedBlock = createStudyBlock({
    id: 'b1',
    taskId: 't1',
    startAt: '2026-10-16T06:00:00.000Z',
    endAt: '2026-10-16T07:00:00.000Z'
  });

  const proposal = createPlanProposal({
    blocks: [movedBlock],
    changes: [{ type: 'move', blockId: 'b1', taskId: 't1', before: initialBlock, after: movedBlock, reason: 'Missed session' }]
  });

  // Accept proposed plan
  acceptPlan(state, proposal, 'recovery');
  assert.equal(state.blocks[0].startAt, '2026-10-16T06:00:00.000Z');
  assert.equal(state.history.length, 1);

  // Undo plan restores initial block exactly
  const undoResult = undoPlan(state);
  assert.equal(undoResult.undone, true);
  assert.equal(state.blocks[0].startAt, '2026-10-15T06:00:00.000Z');
  assert.equal(state.history.length, 0);

  // Subsequent undo returns false cleanly
  const secondUndo = undoPlan(state);
  assert.equal(secondUndo.undone, false);
});

test('store.js: progress tracking, partial completion, and no double subtraction', () => {
  const task = createTask({ id: 't1', title: 'Machine Problem', remainingMinutes: 120 });
  const block = createStudyBlock({
    id: 'b1',
    taskId: 't1',
    startAt: '2026-10-15T06:00:00.000Z',
    endAt: '2026-10-15T08:00:00.000Z', // 120 minutes block
    completedMinutes: 0
  });

  const state = createAppState({
    tasks: [task],
    blocks: [block]
  });

  // 1. Partial completion: User reports 45 minutes completed
  const p1 = recordProgress(state, { blockId: 'b1', completedMinutes: 45 });
  assert.equal(p1.deltaMinutes, 45);
  assert.equal(block.completedMinutes, 45);
  assert.equal(block.status, BLOCK_STATUS.PARTIALLY_COMPLETED);
  assert.equal(task.remainingMinutes, 75); // 120 - 45 = 75
  assert.equal(task.status, 'open');

  // 2. Repeated call with same 45 minutes must NOT subtract effort twice!
  const p2 = recordProgress(state, { blockId: 'b1', completedMinutes: 45 });
  assert.equal(p2.deltaMinutes, 0);
  assert.equal(task.remainingMinutes, 75);

  // 3. User finishes the session (120 minutes completed)
  const p3 = recordProgress(state, { blockId: 'b1', status: BLOCK_STATUS.COMPLETED });
  assert.equal(p3.deltaMinutes, 75); // 120 - 45 = 75 additional
  assert.equal(block.completedMinutes, 120);
  assert.equal(block.status, BLOCK_STATUS.COMPLETED);
  assert.equal(task.remainingMinutes, 0);
  assert.equal(task.status, TASK_STATUS.DONE);

  // 4. Repeated Done must NOT subtract effort twice
  const p4 = recordProgress(state, { blockId: 'b1', status: BLOCK_STATUS.COMPLETED });
  assert.equal(p4.deltaMinutes, 0);
  assert.equal(task.remainingMinutes, 0);
});

test('store.js: missed session with partial work does not add or double-subtract', () => {
  const task = createTask({ id: 't2', title: 'Literature Review', remainingMinutes: 120 });
  const block = createStudyBlock({
    id: 'b2',
    taskId: 't2',
    startAt: '2026-10-15T06:00:00.000Z',
    endAt: '2026-10-15T08:00:00.000Z', // 120 min block
    completedMinutes: 0
  });

  const state = createAppState({
    tasks: [task],
    blocks: [block]
  });

  // User did 30 minutes before having to stop; block marked missed
  recordProgress(state, { blockId: 'b2', completedMinutes: 30, status: BLOCK_STATUS.MISSED });
  assert.equal(block.completedMinutes, 30);
  assert.equal(block.status, BLOCK_STATUS.MISSED);
  // Exactly 90 minutes remaining for the scheduler to replan
  assert.equal(task.remainingMinutes, 90);
  assert.equal(task.status, 'open');
});

test('store.js: demo fixtures load ONLY through an explicit action', () => {
  const storage = createMockStorage();

  // Fresh load produces clean empty AppState (NEVER silently loads demo tasks)
  const cleanState = loadState(storage);
  assert.equal(cleanState.tasks.length, 0);
  assert.equal(cleanState.commitments.length, 0);
  assert.equal(cleanState.blocks.length, 0);

  // Explicit demo fixtures action loads the realistic student week
  const demoState = loadDemoFixtures(new Date('2026-10-12T00:00:00Z'), storage);
  assert.equal(demoState.tasks.length, 3);
  assert.equal(demoState.commitments.length, 5);
  assert.equal(demoState.availability.length, 7);
  assert.equal(demoState.blocks.length, 3);
  assert.ok(demoState.blocks.every(block => Date.parse(block.startAt) >= Date.parse('2026-10-12T00:00:00Z')));

  // Subsequent load returns the explicitly loaded demo fixtures
  const reloaded = loadState(storage);
  assert.equal(reloaded.tasks.length, 3);
});

test('v1 migration preserves fixed commitments and accepted planner data', () => {
  const storage = createMockStorage();
  const raw = JSON.stringify({
    tasks: [
      {id:'study',title:'Study',course:'BIO',minutes:90,day:0,time:'09:00',dueDay:3,status:'planned'},
      {id:'class',title:'Biology lecture',kind:'fixed',minutes:0,sessionMinutes:60,day:1,time:'10:00',status:'planned'}
    ],
    planner: {
      accepted:true,
      availability:[{id:'window',startAt:'2026-10-11T01:00:00.000Z',endAt:'2026-10-11T04:00:00.000Z'}],
      commitments:[{id:'commitment',title:'Lab',startAt:'2026-10-12T01:00:00.000Z',endAt:'2026-10-12T02:00:00.000Z'}],
      blocks:[{id:'planned',taskId:'study',startAt:'2026-10-11T01:00:00.000Z',endAt:'2026-10-11T02:30:00.000Z',locked:true,status:'planned',completedMinutes:0}]
    }
  });
  const state = migrateV1(raw, storage);
  assert.equal(storage.getItem(STORAGE_KEY_V1_BACKUP), raw);
  assert.deepEqual(state.tasks.map(task=>task.id), ['study']);
  assert.equal(state.commitments.length, 2);
  assert.equal(state.commitments.find(item=>item.id==='class').title, 'Biology lecture');
  assert.equal(state.availability.length, 1);
  assert.equal(state.availability[0].id, 'window');
  assert.deepEqual(state.blocks.map(block=>block.id), ['planned']);
  assert.equal(state.blocks[0].locked, true);
  assert.equal(state.blocks[0].startAt, '2026-10-11T01:00:00.000Z');
  assert.ok(state.tasks[0].dueAt.endsWith('Z'));
  assert.equal(validateAppState(state).valid, true);
});
