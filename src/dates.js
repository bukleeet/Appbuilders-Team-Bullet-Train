/**
 * WeekBack — Date & Time Utilities
 * Timezone: Asia/Manila (UTC+8, no DST)
 * Timestamps: Explicit UTC ISO 8601 strings (e.g., 2026-10-10T06:00:00.000Z)
 * Intervals: Half-open [startAt, endAt)
 */

export const DEFAULT_TIMEZONE = 'Asia/Manila';
export const MANILA_OFFSET_HOURS = 8;
export const MANILA_OFFSET_MS = MANILA_OFFSET_HOURS * 60 * 60 * 1000;

/**
 * Validates whether a value is a valid ISO 8601 date string.
 * @param {string} val
 * @returns {boolean}
 */
export function isValidISOString(val) {
  if (typeof val !== 'string' || !val) return false;
  const d = new Date(val);
  return !Number.isNaN(d.getTime());
}

/**
 * Converts a Date object, number, or date string to an explicit UTC ISO string.
 * @param {Date|number|string} dateInput
 * @returns {string}
 */
export function toUTCString(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`Invalid date input: ${dateInput}`);
  }
  return d.toISOString();
}

/**
 * Formats an ISO string in a given timezone with custom Intl options.
 * @param {string|Date} dateInput
 * @param {Intl.DateTimeFormatOptions} options
 * @param {string} [timezone=DEFAULT_TIMEZONE]
 * @returns {string}
 */
export function formatInTimezone(dateInput, options = {}, timezone = DEFAULT_TIMEZONE) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: timezone,
    ...options
  }).format(d);
}

/**
 * Formats a date string for display (e.g., "Sat, Oct 10").
 * @param {string|Date} dateInput
 * @param {string} [timezone=DEFAULT_TIMEZONE]
 * @returns {string}
 */
export function formatDate(dateInput, timezone = DEFAULT_TIMEZONE) {
  return formatInTimezone(dateInput, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }, timezone);
}

/**
 * Formats time in 24-hour format (e.g., "14:00").
 * @param {string|Date} dateInput
 * @param {string} [timezone=DEFAULT_TIMEZONE]
 * @returns {string}
 */
export function formatTime(dateInput, timezone = DEFAULT_TIMEZONE) {
  return formatInTimezone(dateInput, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }, timezone);
}

/**
 * Formats date and time together (e.g., "Sat, Oct 10 · 14:00").
 * @param {string|Date} dateInput
 * @param {string} [timezone=DEFAULT_TIMEZONE]
 * @returns {string}
 */
export function formatDateTime(dateInput, timezone = DEFAULT_TIMEZONE) {
  const dateStr = formatDate(dateInput, timezone);
  const timeStr = formatTime(dateInput, timezone);
  return `${dateStr} · ${timeStr}`;
}

/**
 * Parses calendar date ("YYYY-MM-DD") and time ("HH:mm") in Asia/Manila (UTC+8) into a UTC ISO string.
 * @param {string} dateStr "YYYY-MM-DD"
 * @param {string} timeStr "HH:mm"
 * @param {string} [timezone=DEFAULT_TIMEZONE]
 * @returns {string} ISO UTC string
 */
export function parseInTimezone(dateStr, timeStr = '00:00', timezone = DEFAULT_TIMEZONE) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid dateStr format, expected YYYY-MM-DD: ${dateStr}`);
  }
  const cleanTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(cleanTime)) {
    throw new Error(`Invalid timeStr format, expected HH:mm or HH:mm:ss: ${timeStr}`);
  }

  if (timezone === DEFAULT_TIMEZONE || timezone === 'Asia/Manila') {
    // Asia/Manila has a constant +08:00 offset without DST
    const combined = `${dateStr}T${cleanTime}+08:00`;
    const d = new Date(combined);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Failed to parse date/time: ${combined}`);
    }
    return d.toISOString();
  }

  // Fallback for general timezones:
  const targetLocalMs = new Date(`${dateStr}T${cleanTime}Z`).getTime();
  const probe = new Date(targetLocalMs);
  const tzFormatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).format(probe);

  const [tzDate, tzTime] = tzFormatted.split(', ');
  const tzMs = new Date(`${tzDate}T${tzTime}Z`).getTime();
  const offset = tzMs - targetLocalMs;
  return new Date(targetLocalMs - offset).toISOString();
}

/**
 * Extracts local date ("YYYY-MM-DD") and time ("HH:mm") in the specified timezone from an ISO UTC string.
 * @param {string|Date} dateInput
 * @param {string} [timezone=DEFAULT_TIMEZONE]
 * @returns {{ date: string, time: string }}
 */
export function toLocalDateAndTime(dateInput, timezone = DEFAULT_TIMEZONE) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`Invalid date input: ${dateInput}`);
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(d);

  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}`
  };
}

/**
 * Adds minutes to an ISO string and returns a new ISO UTC string.
 * @param {string|Date} dateInput
 * @param {number} minutes
 * @returns {string} ISO UTC string
 */
export function addMinutes(dateInput, minutes) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`Invalid date input: ${dateInput}`);
  }
  return new Date(d.getTime() + minutes * 60 * 1000).toISOString();
}

/**
 * Calculates duration in minutes between startAt and endAt.
 * @param {string|Date} startAt
 * @param {string|Date} endAt
 * @returns {number}
 */
export function diffMinutes(startAt, endAt) {
  const s = new Date(startAt).getTime();
  const e = new Date(endAt).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) {
    throw new TypeError(`Invalid interval: startAt=${startAt}, endAt=${endAt}`);
  }
  return Math.round((e - s) / (60 * 1000));
}

/**
 * Checks if two half-open intervals [startA, endA) and [startB, endB) overlap.
 * Intervals are [startAt, endAt) — start inclusive, end exclusive.
 * Overlap condition: startA < endB && startB < endA.
 * @param {string} startA
 * @param {string} endA
 * @param {string} startB
 * @param {string} endB
 * @returns {boolean}
 */
export function intervalsOverlap(startA, endA, startB, endB) {
  const sa = new Date(startA).getTime();
  const ea = new Date(endA).getTime();
  const sb = new Date(startB).getTime();
  const eb = new Date(endB).getTime();
  return sa < eb && sb < ea;
}

/**
 * Checks if interval [startAt, endAt) is fully contained inside window [winStart, winEnd).
 * @param {string} startAt
 * @param {string} endAt
 * @param {string} winStart
 * @param {string} winEnd
 * @returns {boolean}
 */
export function isWithinWindow(startAt, endAt, winStart, winEnd) {
  const s = new Date(startAt).getTime();
  const e = new Date(endAt).getTime();
  const ws = new Date(winStart).getTime();
  const we = new Date(winEnd).getTime();
  return ws <= s && e <= we;
}

/**
 * Returns half-open day boundaries [startAt, endAt) in the specified timezone for a date.
 * [00:00:00, 24:00:00 / next day 00:00:00)
 * @param {string|Date} dateInput
 * @param {string} [timezone=DEFAULT_TIMEZONE]
 * @returns {{ startAt: string, endAt: string, dateStr: string }}
 */
export function getDayBounds(dateInput, timezone = DEFAULT_TIMEZONE) {
  const { date } = toLocalDateAndTime(dateInput, timezone);
  const startAt = parseInTimezone(date, '00:00', timezone);
  const endAt = addMinutes(startAt, 24 * 60);
  return { startAt, endAt, dateStr: date };
}

/**
 * Returns consecutive day boundaries starting from anchorDate.
 * @param {string|Date} anchorDate
 * @param {string} [timezone=DEFAULT_TIMEZONE]
 * @param {number} [count=7]
 * @returns {Array<{ startAt: string, endAt: string, dateStr: string, label: string }>}
 */
export function getWeekDays(anchorDate = new Date(), timezone = DEFAULT_TIMEZONE, count = 7) {
  const firstDay = getDayBounds(anchorDate, timezone);
  const days = [];
  for (let i = 0; i < count; i++) {
    const startAt = addMinutes(firstDay.startAt, i * 24 * 60);
    const endAt = addMinutes(startAt, 24 * 60);
    const { date } = toLocalDateAndTime(startAt, timezone);
    days.push({
      startAt,
      endAt,
      dateStr: date,
      label: formatDate(startAt, timezone)
    });
  }
  return days;
}
