import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarHours, groupWeekDays, renderWeekList } from '../src/week-view.js';

test('calendar starts at useful daytime hours and can show the full day', () => {
  const sessions = [{ time: '09:30', sessionMinutes: 75 }];
  assert.deepEqual(calendarHours(sessions), { startHour: 7, endHour: 22 });
  assert.deepEqual(calendarHours(sessions, true), { startHour: 0, endHour: 24 });
});

test('calendar expands for early, late, and overnight commitments', () => {
  const sessions = [
    { time: '05:45', kind: 'fixed', minutes: 90 },
    { time: '23:30', sessionMinutes: 120 },
  ];
  assert.deepEqual(calendarHours(sessions), { startHour: 5, endHour: 26 });
  assert.deepEqual(calendarHours(sessions, true), { startHour: 0, endHour: 26 });
  assert.deepEqual(calendarHours([{ time: '00:00', minutes: 30 }]), { startHour: 0, endHour: 22 });
});

test('week agenda groups sessions by the displayed seven days and counts study time only', () => {
  const sessions = [
    { id: 'class', day: 8, kind: 'fixed', minutes: 90 },
    { id: 'study', day: 8, sessionMinutes: 75, minutes: 180 },
    { id: 'future', day: 14, sessionMinutes: 30 },
  ];
  const days = groupWeekDays(sessions, 7);
  assert.equal(days.length, 7);
  assert.deepEqual(days[1].items.map(s => s.id), ['class', 'study']);
  assert.equal(days[1].studyMinutes, 75);
  assert.equal(days[0].items.length, 0);
  assert.equal(days[6].items.length, 0);
});

test('week agenda distinguishes today, empty days, and fixed commitments', () => {
  const markup = renderWeekList([
    { id: 'commitment', day: 0, kind: 'fixed', minutes: 90 },
    { id: 'session', day: 0, sessionMinutes: 45 },
  ], 0, { fullDate: day => `Date ${day}`, row: item => `<button>${item.id}</button>` });
  assert.match(markup, /aria-current="date"/);
  assert.match(markup, /2 sessions · 45 min study/);
  assert.match(markup, /week-day-sessions/);
  assert.match(markup, /<button>commitment<\/button><button>session<\/button>/);
  assert.equal((markup.match(/Nothing scheduled for this day/g) || []).length, 6);
  assert.equal(renderWeekList([], 0, { fullDate: () => '', row: () => '' }), '');
});
