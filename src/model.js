/**
 * WeekBack — Domain Model and Contracts
 * Shared Contract schemaVersion: 2
 * IDs are stable strings. Intervals are [startAt, endAt).
 */

import { isValidISOString } from './dates.js';

export const SCHEMA_VERSION = 2;
export const DEFAULT_TIMEZONE = 'Asia/Manila';

export const TASK_STATUS = Object.freeze({
  OPEN: 'open',
  DONE: 'done'
});

export const BLOCK_STATUS = Object.freeze({
  PLANNED: 'planned',
  COMPLETED: 'completed',
  PARTIALLY_COMPLETED: 'partially_completed',
  MISSED: 'missed'
});

/**
 * Generates a stable string ID.
 * @param {string} [prefix='']
 * @returns {string}
 */
export function generateId(prefix = '') {
  let uniquePart;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    uniquePart = crypto.randomUUID();
  } else {
    uniquePart = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return prefix ? `${prefix}_${uniquePart}` : uniquePart;
}

/**
 * Creates a valid AppState object.
 * @param {Partial<{
 *   timezone: string,
 *   tasks: any[],
 *   commitments: any[],
 *   availability: any[],
 *   blocks: any[],
 *   history: any[]
 * }>} [data]
 * @returns {import('./model.js').AppState}
 */
export function createAppState(data = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    timezone: data.timezone || DEFAULT_TIMEZONE,
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    commitments: Array.isArray(data.commitments) ? data.commitments : [],
    availability: Array.isArray(data.availability) ? data.availability : [],
    blocks: Array.isArray(data.blocks) ? data.blocks : [],
    history: Array.isArray(data.history) ? data.history : []
  };
}

/**
 * Creates a Task object matching the Shared Contract.
 * Task: id, title, course, dueAt|null, remainingMinutes, status(open/done), steps, sourceText.
 * @param {object} params
 * @returns {object}
 */
export function createTask({
  id,
  title,
  course = '',
  dueAt = null,
  remainingMinutes = 60,
  status = TASK_STATUS.OPEN,
  steps = [],
  sourceText = ''
} = {}) {
  const normStatus = status === TASK_STATUS.DONE ? TASK_STATUS.DONE : TASK_STATUS.OPEN;
  const taskObj = {
    id: typeof id === 'string' && id ? id : generateId('task'),
    title: typeof title === 'string' ? title.trim() : '',
    course: typeof course === 'string' ? course.trim() : '',
    dueAt: dueAt && isValidISOString(dueAt) ? new Date(dueAt).toISOString() : null,
    remainingMinutes: typeof remainingMinutes === 'number' && !Number.isNaN(remainingMinutes)
      ? Math.max(0, Math.round(remainingMinutes))
      : 60,
    status: normStatus,
    steps: Array.isArray(steps) ? steps.map((s, idx) => {
      if (typeof s === 'string') {
        return { id: generateId(`step_${idx}`), title: s, completed: false };
      }
      return {
        id: s.id || generateId(`step_${idx}`),
        title: s.title || '',
        completed: Boolean(s.completed),
        estimatedMinutes: typeof s.estimatedMinutes === 'number' ? s.estimatedMinutes : null
      };
    }) : [],
    sourceText: typeof sourceText === 'string' ? sourceText : ''
  };

  Object.defineProperty(taskObj, 'minutes', {
    get() { return this.remainingMinutes; },
    set(v) { this.remainingMinutes = v; },
    enumerable: false,
    configurable: true
  });
  Object.defineProperty(taskObj, 'day', {
    get() { return 0; },
    enumerable: false,
    configurable: true
  });
  Object.defineProperty(taskObj, 'time', {
    get() { return this.dueAt ? this.dueAt.slice(11, 16) : '14:00'; },
    enumerable: false,
    configurable: true
  });

  return taskObj;
}

/**
 * Creates a Commitment matching the Shared Contract.
 * Commitment: id, title, startAt, endAt (half-open [startAt, endAt)).
 * @param {object} params
 * @returns {object}
 */
export function createCommitment({
  id,
  title,
  startAt,
  endAt
} = {}) {
  if (!startAt || !endAt) {
    throw new Error('Commitment requires startAt and endAt');
  }
  return {
    id: typeof id === 'string' && id ? id : generateId('cmt'),
    title: typeof title === 'string' ? title.trim() : '',
    startAt: new Date(startAt).toISOString(),
    endAt: new Date(endAt).toISOString()
  };
}

/**
 * Creates an Availability Window matching the Shared Contract.
 * Window: id, startAt, endAt (half-open [startAt, endAt)).
 * @param {object} params
 * @returns {object}
 */
export function createWindow({
  id,
  startAt,
  endAt
} = {}) {
  if (!startAt || !endAt) {
    throw new Error('Window requires startAt and endAt');
  }
  return {
    id: typeof id === 'string' && id ? id : generateId('win'),
    startAt: new Date(startAt).toISOString(),
    endAt: new Date(endAt).toISOString()
  };
}

/**
 * Creates a StudyBlock matching the Shared Contract.
 * StudyBlock: id, taskId, startAt, endAt, locked, status, completedMinutes.
 * @param {object} params
 * @returns {object}
 */
export function createStudyBlock({
  id,
  taskId,
  startAt,
  endAt,
  locked = false,
  status = BLOCK_STATUS.PLANNED,
  completedMinutes = 0
} = {}) {
  if (!taskId) {
    throw new Error('StudyBlock requires taskId');
  }
  if (!startAt || !endAt) {
    throw new Error('StudyBlock requires startAt and endAt');
  }
  return {
    id: typeof id === 'string' && id ? id : generateId('blk'),
    taskId: String(taskId),
    startAt: new Date(startAt).toISOString(),
    endAt: new Date(endAt).toISOString(),
    locked: Boolean(locked),
    status: String(status || BLOCK_STATUS.PLANNED),
    completedMinutes: typeof completedMinutes === 'number' && !Number.isNaN(completedMinutes)
      ? Math.max(0, Math.round(completedMinutes))
      : 0
  };
}

/**
 * Creates a TaskDraft matching the Shared Contract.
 * TaskDraft: title, course, dueAt|null, estimatedMinutes|null, steps, missingFields, warnings.
 * @param {object} params
 * @returns {object}
 */
export function createTaskDraft({
  title = '',
  course = '',
  dueAt = null,
  estimatedMinutes = null,
  steps = [],
  missingFields = [],
  warnings = []
} = {}) {
  return {
    title: typeof title === 'string' ? title : '',
    course: typeof course === 'string' ? course : '',
    dueAt: dueAt && isValidISOString(dueAt) ? new Date(dueAt).toISOString() : null,
    estimatedMinutes: typeof estimatedMinutes === 'number' && !Number.isNaN(estimatedMinutes)
      ? Math.round(estimatedMinutes)
      : null,
    steps: Array.isArray(steps) ? steps : [],
    missingFields: Array.isArray(missingFields) ? missingFields : [],
    warnings: Array.isArray(warnings) ? warnings : []
  };
}

/**
 * Creates a PlanProposal matching the Shared Contract.
 * PlanProposal: blocks[], changes[{type,blockId,taskId,before,after,reason}], unallocated[{taskId,minutes,reason}], warnings[].
 * @param {object} params
 * @returns {object}
 */
export function createPlanProposal({
  blocks = [],
  changes = [],
  unallocated = [],
  warnings = []
} = {}) {
  return {
    blocks: Array.isArray(blocks) ? blocks : [],
    changes: Array.isArray(changes) ? changes : [],
    unallocated: Array.isArray(unallocated) ? unallocated : [],
    warnings: Array.isArray(warnings) ? warnings : []
  };
}

/**
 * Validates half-open interval [startAt, endAt).
 * @param {string} startAt
 * @param {string} endAt
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateInterval(startAt, endAt) {
  if (!isValidISOString(startAt)) {
    return { valid: false, error: `Invalid startAt ISO timestamp: ${startAt}` };
  }
  if (!isValidISOString(endAt)) {
    return { valid: false, error: `Invalid endAt ISO timestamp: ${endAt}` };
  }
  const s = new Date(startAt).getTime();
  const e = new Date(endAt).getTime();
  if (s >= e) {
    return { valid: false, error: `Interval [startAt, endAt) must have startAt < endAt (got ${startAt} >= ${endAt})` };
  }
  return { valid: true };
}

/**
 * Validates a Task object against the contract.
 * @param {any} task
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTask(task) {
  const errors = [];
  if (!task || typeof task !== 'object') {
    return { valid: false, errors: ['Task must be an object'] };
  }
  if (typeof task.id !== 'string' || !task.id) errors.push('Task requires non-empty string id');
  if (typeof task.title !== 'string') errors.push('Task requires string title');
  if (typeof task.course !== 'string') errors.push('Task requires string course');
  if (task.dueAt !== null && !isValidISOString(task.dueAt)) errors.push(`Task dueAt must be ISO string or null, got: ${task.dueAt}`);
  if (typeof task.remainingMinutes !== 'number' || task.remainingMinutes < 0) errors.push('Task remainingMinutes must be non-negative number');
  if (task.status !== TASK_STATUS.OPEN && task.status !== TASK_STATUS.DONE) errors.push(`Task status must be 'open' or 'done', got: ${task.status}`);
  if (!Array.isArray(task.steps)) errors.push('Task steps must be an array');
  if (typeof task.sourceText !== 'string') errors.push('Task sourceText must be a string');
  return { valid: errors.length === 0, errors };
}

/**
 * Validates a StudyBlock against the contract.
 * @param {any} block
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateStudyBlock(block) {
  const errors = [];
  if (!block || typeof block !== 'object') {
    return { valid: false, errors: ['StudyBlock must be an object'] };
  }
  if (typeof block.id !== 'string' || !block.id) errors.push('StudyBlock requires string id');
  if (typeof block.taskId !== 'string' || !block.taskId) errors.push('StudyBlock requires string taskId');
  const iv = validateInterval(block.startAt, block.endAt);
  if (!iv.valid) errors.push(iv.error);
  if (typeof block.locked !== 'boolean') errors.push('StudyBlock locked must be boolean');
  if (typeof block.status !== 'string') errors.push('StudyBlock status must be string');
  if (typeof block.completedMinutes !== 'number' || block.completedMinutes < 0) errors.push('StudyBlock completedMinutes must be non-negative number');
  return { valid: errors.length === 0, errors };
}

/**
 * Validates a Commitment against the contract.
 * @param {any} commitment
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCommitment(commitment) {
  const errors = [];
  if (!commitment || typeof commitment !== 'object') {
    return { valid: false, errors: ['Commitment must be an object'] };
  }
  if (typeof commitment.id !== 'string' || !commitment.id) errors.push('Commitment requires string id');
  if (typeof commitment.title !== 'string') errors.push('Commitment requires string title');
  const iv = validateInterval(commitment.startAt, commitment.endAt);
  if (!iv.valid) errors.push(iv.error);
  return { valid: errors.length === 0, errors };
}

/**
 * Validates an Availability Window against the contract.
 * @param {any} window
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateWindow(window) {
  const errors = [];
  if (!window || typeof window !== 'object') {
    return { valid: false, errors: ['Window must be an object'] };
  }
  if (typeof window.id !== 'string' || !window.id) errors.push('Window requires string id');
  const iv = validateInterval(window.startAt, window.endAt);
  if (!iv.valid) errors.push(iv.error);
  return { valid: errors.length === 0, errors };
}

/**
 * Validates full AppState against schemaVersion=2 and Shared Contract.
 * @param {any} state
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAppState(state) {
  const errors = [];
  if (!state || typeof state !== 'object') {
    return { valid: false, errors: ['AppState must be a non-null object'] };
  }
  if (state.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion: expected ${SCHEMA_VERSION}, received ${state.schemaVersion}`);
  }
  if (typeof state.timezone !== 'string' || !state.timezone) {
    errors.push('AppState requires string timezone');
  }
  if (!Array.isArray(state.tasks)) {
    errors.push('AppState tasks must be an array');
  } else {
    state.tasks.forEach((t, i) => {
      const tv = validateTask(t);
      if (!tv.valid) {
        tv.errors.forEach(e => errors.push(`tasks[${i}]: ${e}`));
      }
    });
  }
  if (!Array.isArray(state.commitments)) {
    errors.push('AppState commitments must be an array');
  } else {
    state.commitments.forEach((c, i) => {
      const cv = validateCommitment(c);
      if (!cv.valid) {
        cv.errors.forEach(e => errors.push(`commitments[${i}]: ${e}`));
      }
    });
  }
  if (!Array.isArray(state.availability)) {
    errors.push('AppState availability must be an array');
  } else {
    state.availability.forEach((w, i) => {
      const wv = validateWindow(w);
      if (!wv.valid) {
        wv.errors.forEach(e => errors.push(`availability[${i}]: ${e}`));
      }
    });
  }
  if (!Array.isArray(state.blocks)) {
    errors.push('AppState blocks must be an array');
  } else {
    state.blocks.forEach((b, i) => {
      const bv = validateStudyBlock(b);
      if (!bv.valid) {
        bv.errors.forEach(e => errors.push(`blocks[${i}]: ${e}`));
      }
    });
  }
  if (!Array.isArray(state.history)) {
    errors.push('AppState history must be an array');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validates a PlanProposal object.
 * @param {any} proposal
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePlanProposal(proposal) {
  const errors = [];
  if (!proposal || typeof proposal !== 'object') {
    return { valid: false, errors: ['PlanProposal must be an object'] };
  }
  if (!Array.isArray(proposal.blocks)) errors.push('PlanProposal blocks must be an array');
  if (!Array.isArray(proposal.changes)) errors.push('PlanProposal changes must be an array');
  if (!Array.isArray(proposal.unallocated)) errors.push('PlanProposal unallocated must be an array');
  if (!Array.isArray(proposal.warnings)) errors.push('PlanProposal warnings must be an array');
  return { valid: errors.length === 0, errors };
}
