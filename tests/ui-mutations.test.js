import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppState, createTask, createStudyBlock} from '../src/model.js';
import {acceptPlan, undoPlan} from '../src/store.js';
import {saveTaskEdit, recordSessionProgress} from '../src/ui-mutations.js';

function plannedState() {
  const state = createAppState({tasks:[createTask({id:'t',title:'Homework',remainingMinutes:60})]});
  acceptPlan(state, {changes:[],unallocated:[],warnings:[],blocks:[createStudyBlock({id:'b',taskId:'t',startAt:'2026-10-13T01:00:00.000Z',endAt:'2026-10-13T02:00:00.000Z'})]});
  assert.equal(state.history.length, 1);
  return state;
}

for (const editing of [false, true]) test(`task ${editing?'edit':'addition'} survives attempted plan undo`, () => {
  const state = plannedState();
  saveTaskEdit(state, createTask({id:editing?'t':'new',title:'Updated homework',remainingMinutes:90}));
  const saved = structuredClone(state);
  assert.equal(undoPlan(state).undone, false);
  assert.deepEqual(state, saved);
});

for (const status of ['partially_completed','completed','missed']) test(`${status} progress survives attempted plan undo`, () => {
  const state = plannedState();
  recordSessionProgress(state, {blockId:'b',status,...(status==='partially_completed'?{completedMinutes:20}:{})});
  assert.equal(state.tasks[0].remainingMinutes, status==='completed'?0:status==='partially_completed'?40:60);
  assert.equal(state.blocks[0].status, status);
  const saved = structuredClone(state);
  assert.equal(undoPlan(state).undone, false);
  assert.deepEqual(state, saved);
});
