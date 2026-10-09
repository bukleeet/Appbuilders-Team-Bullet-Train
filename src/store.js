/**
 * WeekBack — Data and Persistence Layer
 * Owned by: Person 3
 * Features:
 *  - AppState schemaVersion=2
 *  - Versioned localStorage ('weekback-v2')
 *  - v1 migration with automatic backup ('weekback-v1-backup')
 *  - Corrupt data preservation ('weekback-corrupt-<timestamp>')
 *  - Storage failure / quota-error surfacing
 *  - Validated import/export
 *  - Plan acceptance, history tracking, and atomic undo
 *  - Progress tracking (partial completion, idempotence, no double subtraction)
 *  - Explicit demo fixtures (no silent seeding)
 */

import {
  createAppState,
  createTask,
  createStudyBlock,
  validateAppState,
  validatePlanProposal,
  SCHEMA_VERSION,
  DEFAULT_TIMEZONE,
  TASK_STATUS,
  BLOCK_STATUS,
  generateId
} from './model.js';
import {
  diffMinutes,
  parseInTimezone,
  addMinutes,
  toLocalDateAndTime
} from './dates.js';
import { createDemoFixtures } from './fixtures.js';

export const STORAGE_KEY_V2 = 'weekback-v2';
export const STORAGE_KEY_V1 = 'weekback-v1';
export const STORAGE_KEY_V1_BACKUP = 'weekback-v1-backup';
export const STORAGE_KEY_CORRUPT_PREFIX = 'weekback-corrupt-';

/**
 * Custom Error for storage operation failures (quota exceeded, disabled storage, etc.)
 */
export class StorageError extends Error {
  /**
   * @param {string} message
   * @param {Error|any} [cause]
   * @param {object} [metadata]
   */
  constructor(message, cause = null, metadata = {}) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
    this.isQuotaExceeded = Boolean(
      cause && (
        cause.name === 'QuotaExceededError' ||
        cause.code === 22 ||
        cause.code === 1014 ||
        cause.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      )
    );
    this.metadata = metadata;
  }
}

/**
 * Custom Error for invalid import or state validation
 */
export class ValidationError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [errors=[]]
   */
  constructor(message, errors = []) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

// In-memory fallback storage for headless / test environments
class MemoryStorage {
  constructor() {
    this.data = new Map();
  }
  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    this.data.set(key, String(value));
  }
  removeItem(key) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

const memoryStorageInstance = new MemoryStorage();

/**
 * Returns the effective storage interface (localStorage in browser or MemoryStorage fallback).
 * @param {object} [customStorage]
 * @returns {{ getItem: Function, setItem: Function, removeItem: Function }}
 */
export function getStorage(customStorage) {
  if (customStorage && typeof customStorage.getItem === 'function' && typeof customStorage.setItem === 'function') {
    return customStorage;
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return memoryStorageInstance;
}

/**
 * Migrates v1 storage data to v2 format.
 * Preserves original v1 payload in STORAGE_KEY_V1_BACKUP.
 * @param {string} rawV1
 * @param {object} storage
 * @returns {import('./model.js').AppState}
 */
export function migrateV1(rawV1, storage) {
  // 1. Immediately create a backup of the untouched v1 data
  try {
    storage.setItem(STORAGE_KEY_V1_BACKUP, rawV1);
  } catch (err) {
    console.warn('WeekBack: Could not write v1 backup before migration:', err);
  }

  let parsedV1;
  try {
    parsedV1 = JSON.parse(rawV1);
  } catch (parseErr) {
    console.warn('WeekBack: v1 data is not valid JSON, returning clean state.');
    return createAppState();
  }

  if (!parsedV1 || !Array.isArray(parsedV1.tasks)) {
    return createAppState();
  }

  // Determine current week's base date in Asia/Manila for stable date resolution
  const now = new Date();
  const { date: todayDateStr } = toLocalDateAndTime(now, DEFAULT_TIMEZONE);
  const baseDateObj = new Date(`${todayDateStr}T12:00:00+08:00`);

  const tasks = [];
  const blocks = [];

  parsedV1.tasks.forEach((oldTask, idx) => {
    const dayOffset = typeof oldTask.day === 'number' ? oldTask.day : 0;
    const timeStr = typeof oldTask.time === 'string' && oldTask.time ? oldTask.time : '14:00';
    const taskDateMs = baseDateObj.getTime() + dayOffset * 24 * 60 * 60 * 1000;
    const { date: targetDateStr } = toLocalDateAndTime(new Date(taskDateMs), DEFAULT_TIMEZONE);
    const stableStartAt = parseInTimezone(targetDateStr, timeStr, DEFAULT_TIMEZONE);

    const minutes = typeof oldTask.minutes === 'number' ? oldTask.minutes : 60;
    const isDone = oldTask.status === 'done';
    const taskId = typeof oldTask.id === 'string' && oldTask.id ? oldTask.id : generateId(`task_${idx}`);

    const newTask = createTask({
      id: taskId,
      title: oldTask.title || `Migrated Task ${idx + 1}`,
      course: oldTask.course || '',
      dueAt: stableStartAt,
      remainingMinutes: isDone ? 0 : minutes,
      status: isDone ? TASK_STATUS.DONE : TASK_STATUS.OPEN,
      steps: [],
      sourceText: 'Migrated from v1 storage'
    });
    tasks.push(newTask);

    // Create a corresponding study block for scheduled tasks
    const blockEndAt = addMinutes(stableStartAt, minutes);
    blocks.push(createStudyBlock({
      id: generateId(`blk_${idx}`),
      taskId,
      startAt: stableStartAt,
      endAt: blockEndAt,
      locked: false,
      status: isDone ? BLOCK_STATUS.COMPLETED : BLOCK_STATUS.PLANNED,
      completedMinutes: isDone ? minutes : 0
    }));
  });

  const migratedState = createAppState({
    timezone: DEFAULT_TIMEZONE,
    tasks,
    commitments: [],
    availability: [],
    blocks,
    history: []
  });

  // Save migrated v2 state to storage
  try {
    storage.setItem(STORAGE_KEY_V2, JSON.stringify(migratedState));
  } catch (err) {
    console.warn('WeekBack: Could not persist migrated v2 state:', err);
  }

  return migratedState;
}

/**
 * Loads AppState from storage.
 * Handles schema v2, v1 migration with backup, and corrupt data preservation.
 * Demo fixtures load ONLY through an explicit action — never silently seeded.
 * @param {object} [customStorage]
 * @returns {import('./model.js').AppState}
 */
export function loadState(customStorage) {
  const storage = getStorage(customStorage);

  // 1. Check for v2 storage
  let rawV2 = null;
  try {
    rawV2 = storage.getItem(STORAGE_KEY_V2);
  } catch (err) {
    console.warn('WeekBack: Unable to access storage during loadState:', err);
    return createAppState();
  }

  if (rawV2 !== null) {
    let parsed;
    try {
      parsed = JSON.parse(rawV2);
    } catch (parseError) {
      // Corrupt JSON: Preserve corrupt data to recovery key
      const recoveryKey = `${STORAGE_KEY_CORRUPT_PREFIX}${Date.now()}`;
      try {
        storage.setItem(recoveryKey, rawV2);
        console.warn(`WeekBack: Preserved corrupt state at ${recoveryKey}`);
      } catch (backupErr) {
        console.error('WeekBack: Failed to preserve corrupt state:', backupErr);
      }
      return createAppState();
    }

    const validation = validateAppState(parsed);
    if (!validation.valid) {
      // Invalid schema: Preserve corrupt/invalid state to recovery key
      const recoveryKey = `${STORAGE_KEY_CORRUPT_PREFIX}${Date.now()}`;
      try {
        storage.setItem(recoveryKey, rawV2);
        console.warn(`WeekBack: Preserved invalid state at ${recoveryKey}. Errors:`, validation.errors);
      } catch (backupErr) {
        console.error('WeekBack: Failed to preserve invalid state:', backupErr);
      }
      return createAppState();
    }

    return parsed;
  }

  // 2. Check for v1 storage and migrate if found
  let rawV1 = null;
  try {
    rawV1 = storage.getItem(STORAGE_KEY_V1);
  } catch (err) {
    console.warn('WeekBack: Unable to check v1 storage:', err);
  }

  if (rawV1 !== null) {
    return migrateV1(rawV1, storage);
  }

  // 3. Return clean initial AppState (no silent demo seeding)
  return createAppState();
}

/**
 * Saves AppState to storage.
 * Validates state before saving and surfaces storage quota errors.
 * @param {import('./model.js').AppState} state
 * @param {object} [customStorage]
 * @returns {{ success: boolean, state: import('./model.js').AppState }}
 */
export function saveState(state, customStorage) {
  const validation = validateAppState(state);
  if (!validation.valid) {
    throw new ValidationError('Cannot save invalid AppState', validation.errors);
  }

  const storage = getStorage(customStorage);
  const serialized = JSON.stringify(state);

  try {
    storage.setItem(STORAGE_KEY_V2, serialized);
    return { success: true, state };
  } catch (err) {
    const storageError = new StorageError(
      'Changes could not be saved to local storage. Please export a backup from Settings.',
      err,
      { recoverableData: serialized }
    );
    throw storageError;
  }
}

/**
 * Explicit action to load demo fixtures into the planner.
 * @param {Date|string} [anchorDate]
 * @param {object} [customStorage]
 * @returns {import('./model.js').AppState}
 */
export function loadDemoFixtures(anchorDate, customStorage) {
  const demoState = createDemoFixtures(anchorDate);
  saveState(demoState, customStorage);
  return demoState;
}

/**
 * Exports AppState as a formatted JSON string.
 * @param {import('./model.js').AppState} state
 * @returns {string}
 */
export function exportState(state) {
  const validation = validateAppState(state);
  if (!validation.valid) {
    throw new ValidationError('Cannot export invalid AppState', validation.errors);
  }
  return JSON.stringify(state, null, 2);
}

/**
 * Imports AppState from JSON string.
 * Validates schemaVersion and data integrity without overwriting existing data if validation fails.
 * @param {string} jsonString
 * @param {object} [customStorage]
 * @returns {{ success: boolean, state: import('./model.js').AppState }}
 */
export function importState(jsonString, customStorage) {
  if (typeof jsonString !== 'string' || !jsonString.trim()) {
    throw new ValidationError('Import failed: Input is empty');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    throw new ValidationError(`Import failed: Malformed JSON (${err.message})`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new ValidationError('Import failed: Top-level data must be an object');
  }

  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new ValidationError(
      `Import failed: Unsupported schemaVersion ${parsed.schemaVersion}. Expected version ${SCHEMA_VERSION}.`
    );
  }

  const validation = validateAppState(parsed);
  if (!validation.valid) {
    throw new ValidationError('Import failed: Data structure does not match contract', validation.errors);
  }

  // Only persist once validation passes completely
  saveState(parsed, customStorage);
  return { success: true, state: parsed };
}

/**
 * Accepts a PlanProposal, records the change in history, and updates blocks.
 * @param {import('./model.js').AppState} state
 * @param {import('./model.js').PlanProposal} planProposal
 * @param {string} [trigger='recovery']
 * @returns {import('./model.js').AppState}
 */
export function acceptPlan(state, planProposal, trigger = 'recovery') {
  const proposalValidation = validatePlanProposal(planProposal);
  if (!proposalValidation.valid) {
    throw new ValidationError('Cannot accept invalid PlanProposal', proposalValidation.errors);
  }

  // Create immutable snapshot of current state for undo
  const historyEntry = {
    id: generateId('hist'),
    createdAt: new Date().toISOString(),
    trigger,
    snapshot: {
      blocks: structuredClone(state.blocks),
      tasks: structuredClone(state.tasks)
    },
    changes: structuredClone(planProposal.changes || []),
    warnings: structuredClone(planProposal.warnings || [])
  };

  state.history.push(historyEntry);

  // Apply new proposed blocks
  state.blocks = structuredClone(planProposal.blocks);

  return state;
}

/**
 * Undoes the most recently accepted plan from history.
 * Restores previous snapshot of blocks and tasks.
 * @param {import('./model.js').AppState} state
 * @returns {{ undone: boolean, state: import('./model.js').AppState, entry?: object }}
 */
export function undoPlan(state) {
  if (!Array.isArray(state.history) || state.history.length === 0) {
    return { undone: false, state };
  }

  const lastEntry = state.history.pop();
  if (lastEntry && lastEntry.snapshot) {
    if (Array.isArray(lastEntry.snapshot.blocks)) {
      state.blocks = structuredClone(lastEntry.snapshot.blocks);
    }
    if (Array.isArray(lastEntry.snapshot.tasks)) {
      state.tasks = structuredClone(lastEntry.snapshot.tasks);
    }
  }

  return { undone: true, state, entry: lastEntry };
}

/**
 * Records progress on a study block or task.
 * Rules:
 *  - Scheduler receives already-updated remainingMinutes; do not subtract progress twice.
 *  - Repeated Done must not subtract effort twice (idempotent delta tracking).
 *  - Partial-completion option: missing a two-hour session must not automatically add two hours if the user already did some work.
 *
 * @param {import('./model.js').AppState} state
 * @param {{
 *   blockId?: string,
 *   taskId?: string,
 *   completedMinutes?: number,
 *   status?: string
 * }} progressData
 * @returns {{ state: import('./model.js').AppState, task?: object, block?: object, deltaMinutes: number }}
 */
export function recordProgress(state, { blockId, taskId, completedMinutes, status }) {
  let block = null;
  let targetTaskId = taskId;

  if (blockId) {
    block = state.blocks.find(b => b.id === blockId);
    if (block && !targetTaskId) {
      targetTaskId = block.taskId;
    }
  }

  const task = targetTaskId ? state.tasks.find(t => t.id === targetTaskId) : null;
  let deltaMinutes = 0;

  if (block) {
    const blockDuration = diffMinutes(block.startAt, block.endAt);
    const prevCompleted = typeof block.completedMinutes === 'number' ? block.completedMinutes : 0;

    let targetCompleted = prevCompleted;
    if (typeof completedMinutes === 'number' && !Number.isNaN(completedMinutes)) {
      targetCompleted = Math.max(0, Math.min(blockDuration, Math.round(completedMinutes)));
    } else if (status === BLOCK_STATUS.COMPLETED || status === 'done') {
      targetCompleted = blockDuration;
    }

    // Delta is only the new additional minutes completed since last record
    deltaMinutes = Math.max(0, targetCompleted - prevCompleted);
    block.completedMinutes = targetCompleted;

    if (status) {
      block.status = status;
    } else if (block.completedMinutes >= blockDuration) {
      block.status = BLOCK_STATUS.COMPLETED;
    } else if (block.completedMinutes > 0) {
      block.status = BLOCK_STATUS.PARTIALLY_COMPLETED;
    }

    if (task && deltaMinutes > 0) {
      task.remainingMinutes = Math.max(0, task.remainingMinutes - deltaMinutes);
      if (task.remainingMinutes === 0) {
        task.status = TASK_STATUS.DONE;
      }
    }
  } else if (task) {
    // Task-level progress update without block
    if (typeof completedMinutes === 'number' && !Number.isNaN(completedMinutes)) {
      deltaMinutes = Math.max(0, Math.round(completedMinutes));
      task.remainingMinutes = Math.max(0, task.remainingMinutes - deltaMinutes);
      if (task.remainingMinutes === 0) {
        task.status = TASK_STATUS.DONE;
      }
    } else if (status === TASK_STATUS.DONE || status === 'done') {
      if (task.status !== TASK_STATUS.DONE) {
        deltaMinutes = task.remainingMinutes;
        task.remainingMinutes = 0;
        task.status = TASK_STATUS.DONE;
      }
    }
  }

  return { state, task, block, deltaMinutes };
}

// Backwards-compatible aliases for src/app.js before Person 4 UI integration
export function load(storage) {
  return loadState(storage);
}

export function save(data, storage) {
  return saveState(data, storage);
}

export function seed() {
  return createDemoFixtures();
}
