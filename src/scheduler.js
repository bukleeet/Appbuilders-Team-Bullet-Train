// Pure scheduling engine. No persistence, no clock reads except the optional `now` default.
// Timestamps are ISO UTC strings; intervals are half-open [startAt, endAt).

const MINUTE = 60_000;

const DEFAULTS = {
  slotMinutes: 15,
  minBlockMinutes: 30,
  maxBlockMinutes: 120,
  gapMinutes: 15,
};

export function planWeek(state, options = {}) {
  return buildProposal(state, options, false);
}

export function repairPlan(state, options = {}) {
  return buildProposal(state, options, true);
}

function buildProposal(state, options, keepValidPlanned) {
  const opts = { ...DEFAULTS, ...options };
  const slot = opts.slotMinutes * MINUTE;
  const gap = opts.gapMinutes * MINUTE;
  const nowMs = options.now == null ? Date.now() : toMs(options.now);
  if (nowMs == null) throw new TypeError('options.now must be a valid timestamp');
  const now = ceilTo(nowMs, slot);
  const warnings = [];

  const tasks = new Map();
  for (const task of state.tasks ?? []) {
    if (!Number.isFinite(task.remainingMinutes) || task.remainingMinutes < 0) {
      warnings.push({ code: 'INVALID_TASK', id: task.id });
      continue;
    }
    const due = task.dueAt == null ? null : toMs(task.dueAt);
    if (task.dueAt != null && due == null) warnings.push({ code: 'INVALID_DEADLINE', id: task.id });
    tasks.set(task.id, { task, due, invalidDue: task.dueAt != null && due == null });
  }

  const availability = mergeIntervals(readIntervals(state.availability, warnings));
  const commitments = readIntervals(state.commitments, warnings);

  // Classify existing blocks.
  const fixed = [];      // kept untouched: locked, done/partial/missed, or planned in the past
  const candidates = []; // unlocked planned blocks at or after now
  for (const block of state.blocks ?? []) {
    const start = toMs(block.startAt);
    const end = toMs(block.endAt);
    const valid = start != null && end != null && end > start;
    if (!valid) warnings.push({ code: 'INVALID_INTERVAL', id: block.id });
    const entry = { block, start, end, valid };
    if (block.locked || block.status !== 'planned') fixed.push(entry);
    else if (valid && start < now) {
      fixed.push(entry);
      warnings.push({ code: 'UNRESOLVED_PAST_BLOCK', id: block.id });
    } else candidates.push(entry);
  }

  // Minutes per task already covered by future planned blocks we keep.
  const covered = new Map();
  const cover = (entry) => {
    if (entry.valid && entry.block.status === 'planned' && entry.start >= now) {
      covered.set(entry.block.taskId, (covered.get(entry.block.taskId) ?? 0) + (entry.end - entry.start));
    }
  };
  fixed.forEach(cover);

  const occupied = fixed.filter((e) => e.valid).map((e) => [e.start, e.end]);
  const kept = [];
  const removed = [];
  candidates.sort(byStart);
  for (const entry of candidates) {
    const reason = keepValidPlanned
      ? invalidReason(entry, { tasks, availability, commitments, occupied, covered, slot })
      : 'REPLANNED';
    if (reason) {
      removed.push({ ...entry, reason });
    } else {
      kept.push(entry);
      occupied.push([entry.start, entry.end]);
      cover(entry);
    }
  }

  // Free time: availability from now on, minus commitments and padded study blocks.
  const blocked = [
    ...commitments,
    ...fixed.concat(kept).filter((e) => e.valid).map((e) => [e.start - gap, e.end + gap]),
  ];
  let free = subtractIntervals(clipStart(availability, now), blocked)
    .map(([s, e]) => [ceilTo(s, slot), floorTo(e, slot)])
    .filter(([s, e]) => e > s);

  // Earliest deadline first; tasks without a deadline last; ties by id.
  const order = [...tasks.values()]
    .filter(({ task }) => task.status !== 'done')
    .sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || compare(a.task.id, b.task.id));

  const added = [];
  const unallocated = [];
  for (const { task, due, invalidDue } of order) {
    let need = ceilTo(task.remainingMinutes * MINUTE, slot) - (covered.get(task.id) ?? 0);
    if (need <= 0) continue;
    if (task.dueAt == null) warnings.push({ code: 'NO_DEADLINE', id: task.id });
    if (invalidDue) {
      unallocated.push({ taskId: task.id, minutes: need / MINUTE, reason: 'INVALID_DEADLINE' });
      continue;
    }
    if (due != null && due <= now) {
      unallocated.push({ taskId: task.id, minutes: need / MINUTE, reason: 'DEADLINE_PASSED' });
      continue;
    }
    const placed = fill(free, need, due ?? Infinity, opts, gap);
    free = placed.free;
    for (const [start, end] of placed.blocks) {
      added.push(newBlock(task.id, start, end));
      need -= end - start;
    }
    if (need > 0) {
      unallocated.push({
        taskId: task.id,
        minutes: need / MINUTE,
        reason: due == null ? 'NO_CAPACITY' : 'NO_CAPACITY_BEFORE_DEADLINE',
      });
    }
  }

  // A new block identical to a dropped one is the same block: keep it instead of churning ids.
  for (let i = removed.length - 1; i >= 0; i--) {
    const old = removed[i];
    const j = added.findIndex((b) => b.taskId === old.block.taskId
      && toMs(b.startAt) === old.start && toMs(b.endAt) === old.end);
    if (j === -1) continue;
    added.splice(j, 1);
    removed.splice(i, 1);
    kept.push(old);
  }

  const blocks = [...fixed.map((e) => e.block), ...kept.map((e) => e.block), ...added]
    .map((b) => ({ ...b }))
    .sort((a, b) => compare(a.startAt, b.startAt) || compare(a.id, b.id));

  return {
    blocks,
    changes: diff(fixed, kept, removed, added, now),
    unallocated,
    warnings,
  };
}

// Why an existing planned block can no longer stay, or null if it is still valid.
function invalidReason(entry, { tasks, availability, commitments, occupied, covered, slot }) {
  const { block, start, end, valid } = entry;
  if (!valid) return 'INVALID_INTERVAL';
  const info = tasks.get(block.taskId);
  if (!info) return 'UNKNOWN_TASK';
  if (info.task.status === 'done') return 'TASK_DONE';
  if (!availability.some(([s, e]) => s <= start && end <= e)) return 'OUTSIDE_AVAILABILITY';
  if (commitments.some((c) => overlaps(c, [start, end]))) return 'CONFLICTS_COMMITMENT';
  if (occupied.some((o) => overlaps(o, [start, end]))) return 'CONFLICTS_BLOCK';
  if (info.invalidDue || (info.due != null && end > info.due)) return 'AFTER_DEADLINE';
  const budget = ceilTo(info.task.remainingMinutes * MINUTE, slot) - (covered.get(block.taskId) ?? 0);
  if (end - start > budget) return 'EXCESS_EFFORT';
  return null;
}

// Place up to `need` ms of study in the earliest free slots ending by `deadline`.
function fill(free, need, deadline, opts, gap) {
  const min = opts.minBlockMinutes * MINUTE;
  const max = opts.maxBlockMinutes * MINUTE;
  const slot = opts.slotMinutes * MINUTE;
  const blocks = [];
  const next = [];
  for (const interval of free) {
    let [s, e] = interval;
    while (need > 0) {
      const limit = Math.min(e, deadline);
      const len = floorTo(Math.min(need, max, limit - s), slot);
      if (len <= 0 || (len < min && len < need)) break;
      blocks.push([s, s + len]);
      need -= len;
      s = ceilTo(s + len + gap, slot);
    }
    if (e > s) next.push([s, e]);
  }
  return { blocks, free: next };
}

function diff(fixed, kept, removed, added, now) {
  const changes = [];
  for (const { block, start } of fixed) {
    if (block.locked && block.status === 'planned' && start >= now) {
      changes.push(change('keep', block, block, 'LOCKED'));
    }
  }
  for (const { block } of kept) changes.push(change('keep', block, block, 'STILL_VALID'));

  // Pair each removed block with a new block for the same task, in time order.
  const pending = new Map();
  for (const block of added) {
    if (!pending.has(block.taskId)) pending.set(block.taskId, []);
    pending.get(block.taskId).push(block);
  }
  for (const { block, reason } of removed) {
    const replacement = pending.get(block.taskId)?.shift();
    changes.push(replacement
      ? change('move', block, replacement, reason)
      : change('remove', block, null, reason));
  }
  for (const list of pending.values()) {
    for (const block of list) changes.push(change('add', null, block, 'SCHEDULED'));
  }

  const at = (c) => (c.after ?? c.before).startAt ?? '';
  return changes.sort((a, b) => compare(at(a), at(b)) || compare(a.blockId, b.blockId));
}

function change(type, before, after, reason) {
  const ref = before ?? after;
  return {
    type,
    blockId: ref.id,
    taskId: ref.taskId,
    before: before && { ...before },
    after: after && { ...after },
    reason,
  };
}

function newBlock(taskId, start, end) {
  const startAt = new Date(start).toISOString();
  return {
    id: `${taskId}@${startAt}`,
    taskId,
    startAt,
    endAt: new Date(end).toISOString(),
    locked: false,
    status: 'planned',
    completedMinutes: 0,
  };
}

function readIntervals(items = [], warnings) {
  const out = [];
  for (const item of items) {
    const start = toMs(item.startAt);
    const end = toMs(item.endAt);
    if (start == null || end == null || end <= start) warnings.push({ code: 'INVALID_INTERVAL', id: item.id });
    else out.push([start, end]);
  }
  return out;
}

function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function subtractIntervals(base, cuts) {
  let result = base;
  for (const [cs, ce] of mergeIntervals(cuts)) {
    result = result.flatMap(([s, e]) => {
      if (ce <= s || cs >= e) return [[s, e]];
      const parts = [];
      if (cs > s) parts.push([s, cs]);
      if (ce < e) parts.push([ce, e]);
      return parts;
    });
  }
  return result;
}

function clipStart(intervals, from) {
  return intervals.filter(([, e]) => e > from).map(([s, e]) => [Math.max(s, from), e]);
}

const overlaps = ([as, ae], [bs, be]) => as < be && bs < ae;
const byStart = (a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || compare(a.block.id, b.block.id);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ceilTo = (ms, step) => Math.ceil(ms / step) * step;
const floorTo = (ms, step) => Math.floor(ms / step) * step;

function toMs(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
