import test from 'node:test';
import assert from 'node:assert/strict';
import { sortedTasks, sortTaskList, matchesTask, overdueTasks, isOverdue } from '../src/task-list.js';

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

test('task browser can sort by title, course and remaining effort without moving completed tasks first', () => {
  const withEffort = tasks.map((task, index) => ({...task, remainingMinutes: [45, 0, 120, 30][index]}));
  assert.deepEqual(sortTaskList(withEffort, 'deadline').map(t => t.id), ['soon','later','undated','done']);
  assert.deepEqual(sortTaskList(withEffort, 'title').map(t => t.id), ['soon','later','undated','done']);
  assert.deepEqual(sortTaskList(withEffort, 'course').map(t => t.id), ['soon','undated','later','done']);
  assert.deepEqual(sortTaskList(withEffort, 'effort').map(t => t.id), ['soon','undated','later','done']);
  assert.deepEqual(sortTaskList(withEffort, 'unknown').map(t => t.id), ['soon','later','undated','done']);
  assert.deepEqual(withEffort.map(t => t.id), ['undated','done','later','soon']);
});

test('tasks with the same sort value retain deadline priority', () => {
  const tied = [
    {id:'later', title:'Shared', course:'CS', status:'open', remainingMinutes:60, dueAt:'2026-10-20T01:00:00Z'},
    {id:'earlier', title:'Shared', course:'CS', status:'open', remainingMinutes:60, dueAt:'2026-10-14T01:00:00Z'}
  ];
  for (const mode of ['title','course','effort']) {
    assert.deepEqual(sortTaskList(tied, mode).map(t => t.id), ['earlier','later']);
  }
});

test('task search matches title and course, with optional status filters', () => {
  assert.deepEqual(tasks.filter(t => matchesTask(t,'report','all')).map(t => t.id), ['done','soon']);
  assert.deepEqual(tasks.filter(t => matchesTask(t,'report cs','open')).map(t => t.id), ['soon']);
  assert.deepEqual(tasks.filter(t => matchesTask(t,'CS','done')).map(t => t.id), ['done']);
  assert.equal(matchesTask(tasks[0],'   ','all'),true);
  assert.equal(matchesTask(tasks[0],'reading chem','all'),false);
});

test('overdue work excludes completed and undated tasks, including at the due instant', () => {
  const now = Date.parse('2026-10-14T01:00:00Z');
  assert.deepEqual(overdueTasks(tasks, now).map(t => t.id), ['soon']);
  assert.equal(isOverdue(tasks[2], Date.parse(tasks[2].dueAt)), false);
  assert.equal(isOverdue(tasks[1], now), false);
  assert.equal(isOverdue({title:'No due date', status:'open', dueAt:'invalid'}, now), false);
  assert.deepEqual(tasks.filter(t => matchesTask(t, 'report', 'overdue', now)).map(t => t.id), ['soon']);
  assert.deepEqual(tasks.filter(t => matchesTask(t, '', 'overdue', now)).map(t => t.id), ['soon']);
});
