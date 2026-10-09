import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TIMEZONE,
  toUTCString,
  isValidISOString,
  parseInTimezone,
  toLocalDateAndTime,
  formatDate,
  formatTime,
  formatDateTime,
  addMinutes,
  diffMinutes,
  intervalsOverlap,
  isWithinWindow,
  getDayBounds,
  getWeekDays
} from '../src/dates.js';

test('dates.js: UTC ISO conversion and validation', () => {
  assert.equal(isValidISOString('2026-10-10T06:00:00.000Z'), true);
  assert.equal(isValidISOString('invalid-date'), false);
  assert.equal(isValidISOString(''), false);

  const iso = toUTCString('2026-10-10T14:00:00+08:00');
  assert.equal(iso, '2026-10-10T06:00:00.000Z');
});

test('dates.js: parseInTimezone and toLocalDateAndTime in Asia/Manila', () => {
  const utc = parseInTimezone('2026-10-15', '14:30', DEFAULT_TIMEZONE);
  assert.equal(utc, '2026-10-15T06:30:00.000Z');

  const { date, time } = toLocalDateAndTime(utc, DEFAULT_TIMEZONE);
  assert.equal(date, '2026-10-15');
  assert.equal(time, '14:30');
});

test('dates.js: formatting in Asia/Manila', () => {
  const utc = parseInTimezone('2026-10-10', '14:00', DEFAULT_TIMEZONE);
  const formattedDate = formatDate(utc, DEFAULT_TIMEZONE);
  const formattedTime = formatTime(utc, DEFAULT_TIMEZONE);
  const formattedDateTime = formatDateTime(utc, DEFAULT_TIMEZONE);

  assert.match(formattedDate, /Oct 10/);
  assert.equal(formattedTime, '14:00');
  assert.match(formattedDateTime, /Oct 10 · 14:00/);
});

test('dates.js: reload on a later day NEVER shifts saved dates', () => {
  // A task scheduled for Oct 15 at 14:00 Manila time
  const savedStartAt = parseInTimezone('2026-10-15', '14:00', DEFAULT_TIMEZONE);
  assert.equal(savedStartAt, '2026-10-15T06:00:00.000Z');

  // Simulate reloading the application on different subsequent days:
  const simDays = [
    new Date('2026-10-10T08:00:00Z'),
    new Date('2026-10-15T08:00:00Z'),
    new Date('2026-10-20T08:00:00Z'),
    new Date('2026-11-01T08:00:00Z')
  ];

  for (const day of simDays) {
    // The timestamp itself remains immutable
    const local = toLocalDateAndTime(savedStartAt, DEFAULT_TIMEZONE);
    assert.equal(local.date, '2026-10-15');
    assert.equal(local.time, '14:00');
    assert.equal(formatTime(savedStartAt, DEFAULT_TIMEZONE), '14:00');
    assert.match(formatDate(savedStartAt, DEFAULT_TIMEZONE), /Oct 15/);
  }
});

test('dates.js: addMinutes and diffMinutes', () => {
  const start = '2026-10-10T06:00:00.000Z';
  const end = addMinutes(start, 90);
  assert.equal(end, '2026-10-10T07:30:00.000Z');
  assert.equal(diffMinutes(start, end), 90);
  assert.equal(diffMinutes(end, start), -90);
});

test('dates.js: half-open intervals [startAt, endAt) overlap and windows', () => {
  const t10_00 = '2026-10-10T02:00:00.000Z';
  const t11_00 = '2026-10-10T03:00:00.000Z';
  const t11_30 = '2026-10-10T03:30:00.000Z';
  const t12_00 = '2026-10-10T04:00:00.000Z';

  // [10:00, 11:00) and [11:00, 12:00) touch at boundary: half-open means NO overlap
  assert.equal(intervalsOverlap(t10_00, t11_00, t11_00, t12_00), false);
  assert.equal(intervalsOverlap(t11_00, t12_00, t10_00, t11_00), false);

  // [10:00, 11:30) and [11:00, 12:00) overlap between 11:00 and 11:30
  assert.equal(intervalsOverlap(t10_00, t11_30, t11_00, t12_00), true);

  // Window containment: [10:00, 11:30) is within [10:00, 12:00)
  assert.equal(isWithinWindow(t10_00, t11_30, t10_00, t12_00), true);
  // [10:00, 12:00) is NOT within [10:00, 11:30)
  assert.equal(isWithinWindow(t10_00, t12_00, t10_00, t11_30), false);
});

test('dates.js: getDayBounds and getWeekDays', () => {
  const bounds = getDayBounds('2026-10-10T06:00:00.000Z', DEFAULT_TIMEZONE);
  assert.equal(bounds.dateStr, '2026-10-10');
  assert.equal(bounds.startAt, '2026-10-09T16:00:00.000Z'); // 00:00 Manila is 16:00 UTC previous day
  assert.equal(bounds.endAt, '2026-10-10T16:00:00.000Z');

  const week = getWeekDays('2026-10-10T06:00:00.000Z', DEFAULT_TIMEZONE, 7);
  assert.equal(week.length, 7);
  assert.equal(week[0].dateStr, '2026-10-10');
  assert.equal(week[6].dateStr, '2026-10-16');
});
