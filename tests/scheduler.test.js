import test from 'node:test';
import assert from 'node:assert/strict';
import { planWeek, repairPlan } from '../src/scheduler.js';

// Monday 2026-10-12 in Asia/Manila (UTC+8). 09:00 Manila = 01:00Z.
const NOW = '2026-10-12T00:00:00.000Z';
const at = (day, hhmm) => `2026-10-${String(12 + day).padStart(2, '0')}T${hhmm}:00.000Z`;
const window = (id, day, from, to) => ({ id, startAt: at(day, from), endAt: at(day, to) });
const task = (id, minutes, dueAt = null, extra = {}) => ({
  id, title: id, course: 'TEST', dueAt, remainingMinutes: minutes, status: 'open', steps: [], sourceText: '', ...extra,
});
const block = (id, taskId, startAt, endAt, extra = {}) => ({
  id, taskId, startAt, endAt, locked: false, status: 'planned', completedMinutes: 0, ...extra,
});
const state = (parts) => ({
  schemaVersion: 2, timezone: 'Asia/Manila', tasks: [], commitments: [], availability: [], blocks: [], history: [], ...parts,
});

const mins = (b) => (Date.parse(b.endAt) - Date.parse(b.startAt)) / 60_000;
const planned = (result, taskId) => result.blocks.filter((b) => b.taskId === taskId && b.status === 'planned');
const total = (blocks) => blocks.reduce((sum, b) => sum + mins(b), 0);

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function assertNoOverlap(blocks) {
  const sorted = [...blocks].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(Date.parse(sorted[i].startAt) >= Date.parse(sorted[i - 1].endAt), `${sorted[i].id} overlaps ${sorted[i - 1].id}`);
  }
}

test('schedules work inside availability on a 15-minute grid with 30-120 minute blocks and gaps', () => {
  const s = state({
    tasks: [task('essay', 200, at(3, '12:00'))],
    availability: [window('w1', 0, '01:00', '05:00')],
  });
  const result = planWeek(s, { now: NOW });
  const blocks = planned(result, 'essay');
  assert.equal(total(blocks), 210, '200 minutes rounds up to the 15-minute grid');
  assert.deepEqual(blocks.map((b) => [b.startAt, b.endAt]), [
    [at(0, '01:00'), at(0, '03:00')],
    [at(0, '03:15'), at(0, '04:45')],
  ]);
  for (const b of blocks) {
    assert.ok(mins(b) >= 30 && mins(b) <= 120);
    assert.equal(Date.parse(b.startAt) % (15 * 60_000), 0);
  }
  assert.deepEqual(result.unallocated, []);
  assert.ok(result.changes.every((c) => c.type === 'add' && c.reason === 'SCHEDULED'));
});

test('earliest deadline is scheduled first and no block ends after its deadline', () => {
  const s = state({
    tasks: [task('later', 60, at(4, '12:00')), task('sooner', 60, at(0, '03:00'))],
    availability: [window('w1', 0, '01:00', '06:00')],
  });
  const result = planWeek(s, { now: NOW });
  assert.equal(planned(result, 'sooner')[0].startAt, at(0, '01:00'));
  assert.equal(planned(result, 'later')[0].startAt, at(0, '02:15'));
  for (const b of result.blocks) {
    const due = s.tasks.find((t) => t.id === b.taskId).dueAt;
    assert.ok(Date.parse(b.endAt) <= Date.parse(due));
  }
});

test('work that cannot fit before the deadline is reported, not scheduled late', () => {
  const s = state({
    tasks: [task('ps', 180, at(0, '03:00'))],
    availability: [window('w1', 0, '01:00', '08:00')],
  });
  const result = planWeek(s, { now: NOW });
  assert.equal(total(planned(result, 'ps')), 120);
  assert.deepEqual(result.unallocated, [{ taskId: 'ps', minutes: 60, reason: 'NO_CAPACITY_BEFORE_DEADLINE' }]);
});

test('a deadline already passed is reported as DEADLINE_PASSED', () => {
  const s = state({
    tasks: [task('old', 60, '2026-10-11T00:00:00.000Z')],
    availability: [window('w1', 0, '01:00', '05:00')],
  });
  const result = planWeek(s, { now: NOW });
  assert.deepEqual(result.blocks, []);
  assert.deepEqual(result.unallocated, [{ taskId: 'old', minutes: 60, reason: 'DEADLINE_PASSED' }]);
});

test('commitments are never overlapped, but touching them is fine', () => {
  const s = state({
    tasks: [task('lab', 120, at(2, '12:00'))],
    availability: [window('w1', 0, '01:00', '05:00')],
    commitments: [{ id: 'class', title: 'Class', startAt: at(0, '01:30'), endAt: at(0, '03:00') }],
  });
  const result = planWeek(s, { now: NOW });
  const blocks = planned(result, 'lab');
  assert.deepEqual(blocks.map((b) => [b.startAt, b.endAt]), [
    [at(0, '01:00'), at(0, '01:30')],
    [at(0, '03:00'), at(0, '04:30')],
  ]);
});

test('locked blocks are never moved and count toward the remaining effort', () => {
  const locked = block('L', 'ps', at(0, '04:00'), at(0, '05:00'), { locked: true });
  const s = state({
    tasks: [task('ps', 120, at(2, '12:00'))],
    availability: [window('w1', 0, '01:00', '06:00')],
    blocks: [locked],
  });
  const result = planWeek(s, { now: NOW });
  assert.deepEqual(result.blocks.find((b) => b.id === 'L'), locked);
  assert.equal(total(planned(result, 'ps')), 120, 'only 60 more minutes were added');
  assert.ok(result.changes.some((c) => c.type === 'keep' && c.blockId === 'L' && c.reason === 'LOCKED'));
  assertNoOverlap(result.blocks);
});

test('insufficient capacity is quantified exactly and no time is invented', () => {
  const s = state({
    tasks: [task('a', 300, at(1, '12:00')), task('b', 120, at(1, '12:00'))],
    availability: [window('w1', 0, '01:00', '03:00'), window('w2', 0, '05:00', '06:00')],
  });
  const result = planWeek(s, { now: NOW });
  assert.equal(total(result.blocks), 180);
  const short = result.unallocated.reduce((sum, u) => sum + u.minutes, 0);
  assert.equal(short, 420 - 180);
  for (const b of result.blocks) {
    assert.ok(s.availability.some((w) => w.startAt <= b.startAt && b.endAt <= w.endAt));
  }
});

test('partial progress: remainingMinutes is used as-is and progress blocks are not double counted', () => {
  const done = block('p1', 'ps', '2026-10-11T01:00:00.000Z', '2026-10-11T02:00:00.000Z', { status: 'partial', completedMinutes: 30 });
  const s = state({
    tasks: [task('ps', 90, at(2, '12:00'))],
    availability: [window('w1', 0, '01:00', '05:00')],
    blocks: [done],
  });
  const result = planWeek(s, { now: NOW });
  assert.equal(total(planned(result, 'ps')), 90);
  assert.deepEqual(result.blocks.find((b) => b.id === 'p1'), done);
});

test('done tasks are not scheduled', () => {
  const s = state({
    tasks: [task('ps', 60, at(2, '12:00'), { status: 'done' })],
    availability: [window('w1', 0, '01:00', '05:00')],
  });
  assert.deepEqual(planWeek(s, { now: NOW }).blocks, []);
});

test('tasks without a deadline go after dated tasks and are flagged', () => {
  const s = state({
    tasks: [task('aaa-someday', 60), task('zzz-dated', 60, at(3, '12:00'))],
    availability: [window('w1', 0, '01:00', '05:00')],
  });
  const result = planWeek(s, { now: NOW });
  assert.equal(planned(result, 'zzz-dated')[0].startAt, at(0, '01:00'));
  assert.equal(planned(result, 'aaa-someday')[0].startAt, at(0, '02:15'));
  assert.deepEqual(result.warnings, [{ code: 'NO_DEADLINE', id: 'aaa-someday' }]);
});

test('invalid dates are skipped with warnings instead of guessed', () => {
  const s = state({
    tasks: [task('bad', 60, 'not a date')],
    availability: [window('w1', 0, '01:00', '05:00'), { id: 'w-bad', startAt: 'nope', endAt: at(0, '06:00') }],
  });
  const result = planWeek(s, { now: NOW });
  assert.deepEqual(result.blocks, []);
  assert.deepEqual(result.unallocated, [{ taskId: 'bad', minutes: 60, reason: 'INVALID_DEADLINE' }]);
  assert.ok(result.warnings.some((w) => w.code === 'INVALID_INTERVAL' && w.id === 'w-bad'));
  assert.ok(result.warnings.some((w) => w.code === 'INVALID_DEADLINE' && w.id === 'bad'));
});

test('nothing is scheduled before now', () => {
  const s = state({
    tasks: [task('ps', 60, at(2, '12:00'))],
    availability: [window('w1', 0, '01:00', '05:00')],
  });
  const result = planWeek(s, { now: at(0, '02:07') });
  assert.equal(planned(result, 'ps')[0].startAt, at(0, '02:15'));
});

test('repair keeps valid blocks and moves only the ones hit by a new commitment', () => {
  const base = state({
    tasks: [task('ps', 120, at(3, '12:00'))],
    availability: [window('w1', 0, '01:00', '03:00'), window('w2', 1, '01:00', '03:00')],
  });
  const first = planWeek(base, { now: NOW });
  const original = first.blocks;
  assert.equal(original.length, 1);

  const s = state({
    ...base,
    availability: [...base.availability, window('w3', 2, '01:00', '03:00')],
    commitments: [{ id: 'meeting', title: 'Meeting', startAt: at(0, '02:00'), endAt: at(0, '02:30') }],
    blocks: original,
  });
  const result = repairPlan(s, { now: NOW });
  const move = result.changes.find((c) => c.type === 'move');
  assert.equal(move.reason, 'CONFLICTS_COMMITMENT');
  assert.equal(move.before.id, original[0].id);
  assertNoOverlap([...result.blocks, ...s.commitments]);
  assert.equal(total(planned(result, 'ps')), 120);
});

test('repair leaves still-valid blocks untouched with a keep change', () => {
  const s = state({
    tasks: [task('ps', 60, at(3, '12:00'))],
    availability: [window('w1', 0, '01:00', '05:00')],
    blocks: [block('mine', 'ps', at(0, '03:00'), at(0, '04:00'))],
  });
  const result = repairPlan(s, { now: NOW });
  assert.deepEqual(result.blocks, s.blocks);
  assert.deepEqual(result.changes.map((c) => [c.type, c.blockId, c.reason]), [['keep', 'mine', 'STILL_VALID']]);
});

test('repair removes blocks for finished tasks and trims excess effort', () => {
  const s = state({
    tasks: [task('done', 60, at(3, '12:00'), { status: 'done' }), task('ps', 30, at(3, '12:00'))],
    availability: [window('w1', 0, '01:00', '08:00')],
    blocks: [
      block('d1', 'done', at(0, '01:00'), at(0, '02:00')),
      block('p1', 'ps', at(0, '03:00'), at(0, '03:30')),
      block('p2', 'ps', at(0, '04:00'), at(0, '05:00')),
    ],
  });
  const result = repairPlan(s, { now: NOW });
  const byId = Object.fromEntries(result.changes.map((c) => [c.blockId, c]));
  assert.equal(byId.d1.type, 'remove');
  assert.equal(byId.d1.reason, 'TASK_DONE');
  assert.equal(byId.p1.type, 'keep');
  assert.equal(byId.p2.type, 'remove');
  assert.equal(byId.p2.reason, 'EXCESS_EFFORT');
  assert.deepEqual(result.blocks.map((b) => b.id), ['p1']);
});

test('repair never decides a past planned block was missed', () => {
  const past = block('old', 'ps', '2026-10-11T01:00:00.000Z', '2026-10-11T02:00:00.000Z');
  const s = state({
    tasks: [task('ps', 60, at(3, '12:00'))],
    availability: [window('w1', 0, '01:00', '05:00')],
    blocks: [past],
  });
  const result = repairPlan(s, { now: NOW });
  assert.deepEqual(result.blocks.find((b) => b.id === 'old'), past);
  assert.ok(result.warnings.some((w) => w.code === 'UNRESOLVED_PAST_BLOCK' && w.id === 'old'));
  assert.equal(total(planned(result, 'ps').filter((b) => b.id !== 'old')), 60, 'the past block does not cover future need');
});

test('repair reschedules a missed block from now onward', () => {
  const missed = block('m', 'ps', '2026-10-11T01:00:00.000Z', '2026-10-11T02:00:00.000Z', { status: 'missed' });
  const s = state({
    tasks: [task('ps', 60, at(3, '12:00'))],
    availability: [window('w0', -1, '01:00', '05:00'), window('w1', 0, '01:00', '05:00')],
    blocks: [missed],
  });
  const result = repairPlan(s, { now: NOW });
  const added = result.blocks.filter((b) => b.status === 'planned');
  assert.equal(added.length, 1);
  assert.ok(added[0].startAt >= NOW);
  assert.deepEqual(result.blocks.find((b) => b.id === 'm'), missed);
});

test('replanning an unchanged plan keeps every block instead of churning ids', () => {
  const s = state({
    tasks: [task('ps', 150, at(3, '12:00'))],
    availability: [window('w1', 0, '01:00', '06:00')],
  });
  const first = planWeek(s, { now: NOW });
  const second = planWeek({ ...s, blocks: first.blocks }, { now: NOW });
  assert.deepEqual(second.blocks, first.blocks);
  assert.ok(second.changes.every((c) => c.type === 'keep'));
});

test('output is deterministic and inputs are never mutated', () => {
  const s = deepFreeze(state({
    tasks: [task('b', 90, at(2, '12:00')), task('a', 90, at(2, '12:00')), task('c', 45)],
    availability: [window('w2', 1, '01:00', '04:00'), window('w1', 0, '01:00', '04:00')],
    commitments: [{ id: 'c1', title: 'Class', startAt: at(0, '02:00'), endAt: at(0, '03:00') }],
    blocks: [block('x', 'a', at(1, '01:00'), at(1, '02:00'))],
  }));
  const snapshot = structuredClone(s);
  assert.deepEqual(planWeek(s, { now: NOW }), planWeek(s, { now: NOW }));
  assert.deepEqual(repairPlan(s, { now: NOW }), repairPlan(s, { now: NOW }));
  assert.deepEqual(s, snapshot);
});

test('ties on deadline are broken by task id', () => {
  const s = state({
    tasks: [task('b', 60, at(2, '12:00')), task('a', 60, at(2, '12:00'))],
    availability: [window('w1', 0, '01:00', '05:00')],
  });
  const result = planWeek(s, { now: NOW });
  assert.equal(planned(result, 'a')[0].startAt, at(0, '01:00'));
});

test('options.now is optional and defaults to the real clock', () => {
  const start = new Date(Date.now() + 86_400_000);
  start.setUTCHours(1, 0, 0, 0);
  const end = new Date(start.getTime() + 4 * 3_600_000);
  const s = state({
    tasks: [task('ps', 60, new Date(end.getTime() + 86_400_000).toISOString())],
    availability: [{ id: 'w', startAt: start.toISOString(), endAt: end.toISOString() }],
  });
  const result = planWeek(s);
  assert.equal(planned(result, 'ps')[0].startAt, start.toISOString());
});
