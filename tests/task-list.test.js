import test from 'node:test';
import assert from 'node:assert/strict';
import { sortedTasks, matchesTask } from '../src/task-list.js';

const tasks = [
  {id:'undated',title:'Reading',course:'HIST',status:'open',dueAt:null},
  {id:'done',title:'Finished report',course:'CS',status:'done',dueAt:'2026-10-10T01:00:00Z'},
  {id:'later',title:'Problem set',course:'MATH',status:'open',dueAt:'2026-10-15T01:00:00Z'},
  {id:'soon',title:'Final report',course:'CS',status:'open',dueAt:'2026-10-13T01:00:00Z'}
];

test('task order prioritizes unfinished deadlines while preserving stored order', () => {
  assert.deepEqual(sortedTasks(tasks).map(t => t.id), ['soon','later','undated','done']);
  assert.deepEqual(tasks.map(t => t.id), ['undated','done','later','soon']);
});

test('task search matches title and course, with optional status filters', () => {
  assert.deepEqual(tasks.filter(t => matchesTask(t,'report','all')).map(t => t.id), ['done','soon']);
  assert.deepEqual(tasks.filter(t => matchesTask(t,'report cs','open')).map(t => t.id), ['soon']);
  assert.deepEqual(tasks.filter(t => matchesTask(t,'CS','done')).map(t => t.id), ['done']);
  assert.equal(matchesTask(tasks[0],'   ','all'),true);
  assert.equal(matchesTask(tasks[0],'reading chem','all'),false);
});
