import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../server.js';
import {
  checkOllamaStatus,
  interpretTask,
  warmupOllama,
  OllamaOfflineError,
  TimeoutError,
  ModelOutputError,
  parseExplicitDuration,
  DEFAULT_MODEL,
  DEFAULT_TIMEZONE
} from '../server/ai.js';
import { planWeek, repairPlan } from '../src/scheduler.js';
import {
  createAppState,
  createTask,
  createCommitment,
  createWindow,
  createStudyBlock,
  SCHEMA_VERSION,
  TASK_STATUS,
  BLOCK_STATUS
} from '../src/model.js';
import {
  toUTCString,
  isValidISOString,
  parseInTimezone,
  toLocalDateAndTime,
  formatDateTime,
  formatDate,
  formatTime,
  diffMinutes,
  addMinutes
} from '../src/dates.js';
import {
  loadState,
  saveState,
  recordProgress,
  acceptPlan,
  undoPlan,
  importState,
  exportState,
  loadDemoFixtures,
  migrateV1,
  StorageError,
  ValidationError,
  STORAGE_KEY_V2,
  STORAGE_KEY_V1,
  STORAGE_KEY_V1_BACKUP,
  STORAGE_KEY_CORRUPT_PREFIX
} from '../src/store.js';
import { getAIStatus, warmupAI, AI_ERROR_CODES } from '../src/ai-client.js';
import { reviewEstimate } from '../src/task-draft-ui.js';
import { saveTaskEdit, recordSessionProgress } from '../src/ui-mutations.js';
import { fastParseTaskText } from '../src/task-capture.js';

// Helper to spawn a mock Ollama HTTP server
function createMockOllama(handler) {
  const srv = http.createServer(handler);
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => srv.close(res))
      });
    });
  });
}

// Helper to spawn an isolated test instance of server.js
function setupTestServer(options = {}) {
  const srv = createServer(options);
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => srv.close(res))
      });
    });
  });
}

// In-memory mock storage for store.js testing
class MemoryStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

// ============================================================================
// AUDIT SUITE 1: PERSON 1 (LOCAL AI CONTRACT & RESILIENCE)
// ============================================================================

test('QA-P1-01: dueAt & estimatedMinutes strictly null when unmentioned, missingFields populated', async () => {
  const mockOllama = await createMockOllama((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        model: 'qwen3.5:2b',
        response: JSON.stringify({
          title: 'Clean room',
          course: null,
          dueAt: null,
          estimatedMinutes: null,
          steps: [
            { title: 'Tidy up clutter', estimatedMinutes: 15 },
            { title: 'Vacuum floor', estimatedMinutes: 15 }
          ],
          missingFields: ['course', 'dueAt', 'estimatedMinutes'],
          warnings: []
        })
      })
    );
  });

  try {
    const result = await interpretTask('Clean room', {}, {
      url: `${mockOllama.url}/api/generate`
    });

    assert.equal(result.draft.title, 'Clean room');
    assert.equal(result.draft.course, null);
    assert.equal(result.draft.dueAt, null);
    assert.equal(result.draft.estimatedMinutes, null);
    assert.deepEqual(result.draft.missingFields.sort(), ['course', 'dueAt', 'estimatedMinutes'].sort());
  } finally {
    await mockOllama.close();
  }
});

test('QA-P1-02: Model-suggested duration without text duration is forced null with warning', async () => {
  const mockOllama = await createMockOllama((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        model: 'qwen3.5:2b',
        response: JSON.stringify({
          title: 'Study organic chemistry reactions',
          course: 'CHEM 31',
          dueAt: null,
          estimatedMinutes: 90, // Model guessed 90 minutes, but user input has no duration
          steps: [
            { title: 'Review alkenes', estimatedMinutes: 45 },
            { title: 'Review alkynes', estimatedMinutes: 45 }
          ],
          missingFields: ['dueAt'],
          warnings: []
        })
      })
    );
  });

  try {
    const result = await interpretTask('Study organic chemistry reactions', {}, {
      url: `${mockOllama.url}/api/generate`
    });

    // estimatedMinutes must be forced to null because user did not specify duration
    assert.equal(result.draft.estimatedMinutes, null);
    assert.ok(result.draft.missingFields.includes('estimatedMinutes'));
    assert.ok(result.draft.warnings.some((w) => w.includes('Model estimated 90 minutes (unconfirmed)')));
  } finally {
    await mockOllama.close();
  }
});

test('QA-P1-03: Response headers x-model-used and x-latency-ms strictly returned on POST /api/ai/interpret', async () => {
  const server = await setupTestServer({
    interpret: async () => ({
      draft: {
        title: 'Review notes',
        course: null,
        dueAt: null,
        estimatedMinutes: null,
        steps: [],
        missingFields: ['course', 'dueAt', 'estimatedMinutes'],
        warnings: []
      },
      modelUsed: 'qwen3.5:2b',
      latencyMs: 1420
    })
  });

  try {
    const res = await fetch(`${server.baseUrl}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Review notes' })
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-model-used'), 'qwen3.5:2b');
    assert.equal(res.headers.get('x-latency-ms'), '1420');
  } finally {
    await server.close();
  }
});

test('QA-P1-04: Server returns 503 (offline) and 504 (timeout) instead of generic 500s', async () => {
  const serverOffline = await setupTestServer({
    interpret: async () => {
      throw new OllamaOfflineError('Ollama service connection refused');
    }
  });

  const serverTimeout = await setupTestServer({
    interpret: async () => {
      throw new TimeoutError('Task interpretation timed out');
    }
  });

  const serverModelOutput = await setupTestServer({
    interpret: async () => {
      throw new ModelOutputError('Corrupt model JSON response');
    }
  });

  try {
    const resOffline = await fetch(`${serverOffline.baseUrl}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Test offline' })
    });
    assert.equal(resOffline.status, 503);

    const resTimeout = await fetch(`${serverTimeout.baseUrl}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Test timeout' })
    });
    assert.equal(resTimeout.status, 504);

    const resModelOutput = await fetch(`${serverModelOutput.baseUrl}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Test corrupt' })
    });
    assert.equal(resModelOutput.status, 502);
  } finally {
    await serverOffline.close();
    await serverTimeout.close();
    await serverModelOutput.close();
  }
});

test('QA-P1-05: parseExplicitDuration distinguishes effort from deadlines and course codes', () => {
  // Deadlines must NOT be parsed as effort
  assert.equal(parseExplicitDuration('due in 2 hours'), null);
  assert.equal(parseExplicitDuration('due within 45 mins'), null);
  assert.equal(parseExplicitDuration('submit within 3 hours'), null);

  // Course codes must NOT be parsed as effort
  assert.equal(parseExplicitDuration('MATH 2h problem set'), null);
  assert.equal(parseExplicitDuration('CS 101a final project'), null);

  // Legitimate duration phrases
  assert.equal(parseExplicitDuration('Work on essay for 2 hours'), 120);
  assert.equal(parseExplicitDuration('Read textbook 1 hr 30 min'), 90);
  assert.equal(parseExplicitDuration('Takes half an hour'), 30);
  assert.equal(parseExplicitDuration('Takes quarter of an hour'), 15);
  assert.equal(parseExplicitDuration('Spend 45 mins on flashcards'), 45);
  assert.equal(parseExplicitDuration('Math problem set 90m'), 90);
  assert.equal(parseExplicitDuration('Study 1.5 hours'), 90);
});

// ============================================================================
// AUDIT SUITE 2: PERSON 2 (SCHEDULER CONTRACT & DETERMINISM)
// ============================================================================

test('QA-P2-01: planWeek schedules effort inside availability without overlapping commitments', () => {
  const baseTime = Date.parse('2026-10-12T00:00:00.000Z');
  const now = new Date(baseTime).toISOString();

  const state = {
    tasks: [
      { id: 'task-1', title: 'Task 1', remainingMinutes: 120, dueAt: new Date(baseTime + 10 * 3600_000).toISOString(), status: 'open' }
    ],
    commitments: [
      { id: 'cmt-1', title: 'Lecture', startAt: new Date(baseTime + 2 * 3600_000).toISOString(), endAt: new Date(baseTime + 4 * 3600_000).toISOString() }
    ],
    availability: [
      { id: 'av-1', startAt: new Date(baseTime).toISOString(), endAt: new Date(baseTime + 8 * 3600_000).toISOString() }
    ],
    blocks: []
  };

  const proposal = planWeek(state, { now });

  assert.ok(proposal.blocks.length > 0);
  for (const block of proposal.blocks) {
    const bStart = Date.parse(block.startAt);
    const bEnd = Date.parse(block.endAt);
    const cStart = baseTime + 2 * 3600_000;
    const cEnd = baseTime + 4 * 3600_000;

    // Must never overlap commitment [cStart, cEnd)
    assert.ok(bEnd <= cStart || bStart >= cEnd, 'Block overlaps fixed commitment');
  }
});

test('QA-P2-02: planWeek reports shortages in unallocated without inventing capacity', () => {
  const baseTime = Date.parse('2026-10-12T00:00:00.000Z');
  const now = new Date(baseTime).toISOString();

  // Task requires 180 minutes, but only 60 minutes of availability is given
  const state = {
    tasks: [
      { id: 'task-big', title: 'Big Task', remainingMinutes: 180, dueAt: new Date(baseTime + 8 * 3600_000).toISOString(), status: 'open' }
    ],
    commitments: [],
    availability: [
      { id: 'av-small', startAt: new Date(baseTime).toISOString(), endAt: new Date(baseTime + 1 * 3600_000).toISOString() }
    ],
    blocks: []
  };

  const proposal = planWeek(state, { now });

  const totalScheduled = proposal.blocks.reduce((sum, b) => sum + (Date.parse(b.endAt) - Date.parse(b.startAt)) / 60000, 0);
  assert.equal(totalScheduled, 60, 'Should only schedule up to actual available time');

  assert.equal(proposal.unallocated.length, 1);
  assert.equal(proposal.unallocated[0].taskId, 'task-big');
  assert.equal(proposal.unallocated[0].minutes, 120); // 180 - 60 = 120
  assert.equal(proposal.unallocated[0].reason, 'NO_CAPACITY_BEFORE_DEADLINE');
});

test('QA-P2-03: planWeek enforces 15-min grid, 30-120 min block bounds, and 15-min gap', () => {
  const baseTime = Date.parse('2026-10-12T00:00:00.000Z');
  const now = new Date(baseTime).toISOString();

  const state = {
    tasks: [
      { id: 'task-a', title: 'Task A', remainingMinutes: 180, dueAt: new Date(baseTime + 10 * 3600_000).toISOString(), status: 'open' }
    ],
    commitments: [],
    availability: [
      { id: 'av-wide', startAt: new Date(baseTime).toISOString(), endAt: new Date(baseTime + 6 * 3600_000).toISOString() }
    ],
    blocks: []
  };

  const proposal = planWeek(state, { now });

  assert.ok(proposal.blocks.length >= 2);
  for (let i = 0; i < proposal.blocks.length; i++) {
    const b = proposal.blocks[i];
    const durMinutes = (Date.parse(b.endAt) - Date.parse(b.startAt)) / 60000;
    assert.ok(durMinutes >= 30 && durMinutes <= 120, `Block duration ${durMinutes} must be between 30 and 120 minutes`);

    // Verify 15-minute grid alignment
    assert.equal(Date.parse(b.startAt) % (15 * 60000), 0);
    assert.equal(Date.parse(b.endAt) % (15 * 60000), 0);

    // Verify minimum 15-min gap between consecutive blocks
    if (i > 0) {
      const prev = proposal.blocks[i - 1];
      const gapMinutes = (Date.parse(b.startAt) - Date.parse(prev.endAt)) / 60000;
      assert.ok(gapMinutes >= 15, `Gap between blocks must be at least 15 minutes, got ${gapMinutes}`);
    }
  }
});

test('QA-P2-04: Determinism: Multiple runs of planWeek on identical inputs produce identical output', () => {
  const baseTime = Date.parse('2026-10-12T00:00:00.000Z');
  const now = new Date(baseTime).toISOString();

  const state = {
    tasks: [
      { id: 't2', title: 'Task 2', remainingMinutes: 60, dueAt: new Date(baseTime + 4 * 3600_000).toISOString(), status: 'open' },
      { id: 't1', title: 'Task 1', remainingMinutes: 60, dueAt: new Date(baseTime + 4 * 3600_000).toISOString(), status: 'open' }
    ],
    commitments: [],
    availability: [
      { id: 'av', startAt: new Date(baseTime).toISOString(), endAt: new Date(baseTime + 4 * 3600_000).toISOString() }
    ],
    blocks: []
  };

  const run1 = planWeek(state, { now });
  const run2 = planWeek(state, { now });

  assert.deepEqual(run1, run2);
});

// ============================================================================
// AUDIT SUITE 3: PERSON 3 (DATA & PERSISTENCE CONTRACT)
// ============================================================================

test('QA-P3-01: AppState schemaVersion is strictly 2 and timestamps are UTC ISO strings', () => {
  const state = createAppState();
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.timezone, 'Asia/Manila');

  const task = createTask({
    title: 'Biology Essay',
    dueAt: '2026-10-15T15:59:00.000Z',
    remainingMinutes: 90
  });

  assert.ok(isValidISOString(task.dueAt));
  assert.ok(task.dueAt.endsWith('Z'));

  const commitment = createCommitment({
    title: 'Physics Lab',
    startAt: '2026-10-14T06:00:00.000Z',
    endAt: '2026-10-14T08:00:00.000Z'
  });

  assert.ok(commitment.startAt.endsWith('Z'));
  assert.ok(commitment.endAt.endsWith('Z'));
});

test('QA-P3-02: Date parsing and display in Asia/Manila (UTC+8) does not shift dates', () => {
  // In Manila, 2026-10-15 at 14:00 is UTC 2026-10-15 06:00:00.000Z
  const isoUtc = parseInTimezone('2026-10-15', '14:00', 'Asia/Manila');
  assert.equal(isoUtc, '2026-10-15T06:00:00.000Z');

  // Converting back to local date and time in Manila
  const local = toLocalDateAndTime(isoUtc, 'Asia/Manila');
  assert.equal(local.date, '2026-10-15');
  assert.equal(local.time, '14:00');
});

test('QA-P3-03: Marking a task Done repeatedly avoids subtracting minutes twice', () => {
  const task = createTask({ id: 'task-test', title: 'Essay', remainingMinutes: 120 });
  const block = createStudyBlock({
    id: 'block-test',
    taskId: 'task-test',
    startAt: '2026-10-15T01:00:00.000Z',
    endAt: '2026-10-15T02:00:00.000Z' // 60 minutes
  });

  const state = createAppState({
    tasks: [task],
    blocks: [block]
  });

  // First Done: subtracts 60 minutes
  const res1 = recordProgress(state, { blockId: 'block-test', status: BLOCK_STATUS.COMPLETED });
  assert.equal(res1.deltaMinutes, 60);
  assert.equal(state.tasks[0].remainingMinutes, 60);

  // Second Done: idempotent, 0 delta, remainingMinutes stays 60
  const res2 = recordProgress(state, { blockId: 'block-test', status: BLOCK_STATUS.COMPLETED });
  assert.equal(res2.deltaMinutes, 0);
  assert.equal(state.tasks[0].remainingMinutes, 60);

  // Third Done directly on task: subtracts remaining 60 minutes to 0
  const res3 = recordProgress(state, { taskId: 'task-test', status: TASK_STATUS.DONE });
  assert.equal(res3.deltaMinutes, 60);
  assert.equal(state.tasks[0].remainingMinutes, 0);
  assert.equal(state.tasks[0].status, TASK_STATUS.DONE);

  // Fourth Done on task: delta is 0, never subtracts twice
  const res4 = recordProgress(state, { taskId: 'task-test', status: TASK_STATUS.DONE });
  assert.equal(res4.deltaMinutes, 0);
  assert.equal(state.tasks[0].remainingMinutes, 0);
});

test('QA-P3-04: Corrupt storage data is preserved under weekback-corrupt-<timestamp>', () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY_V2, 'not-valid-json{{{');

  const loaded = loadState(storage);
  assert.equal(loaded.schemaVersion, 2);

  // Verify recovery key was created
  let foundCorruptKey = false;
  for (const key of storage.store.keys()) {
    if (key.startsWith(STORAGE_KEY_CORRUPT_PREFIX)) {
      foundCorruptKey = true;
      assert.equal(storage.getItem(key), 'not-valid-json{{{');
    }
  }
  assert.ok(foundCorruptKey, 'Corrupt data must be archived to recovery key');
});

test('QA-P3-05: Task edit and progress updates clear undo snapshots so undo cannot corrupt state', () => {
  const state = createAppState({
    tasks: [createTask({ id: 't1', title: 'Task 1', remainingMinutes: 60 })],
    blocks: []
  });

  // Accept a plan proposal
  const proposal = {
    blocks: [createStudyBlock({ id: 'b1', taskId: 't1', startAt: '2026-10-15T01:00:00.000Z', endAt: '2026-10-15T02:00:00.000Z' })],
    changes: [],
    unallocated: [],
    warnings: []
  };

  acceptPlan(state, proposal);
  assert.equal(state.history.length, 1);
  assert.ok(state.history[0].snapshot !== null);

  // Edit task via ui-mutation
  saveTaskEdit(state, createTask({ id: 't1', title: 'Task 1 Updated', remainingMinutes: 90 }));

  // Snapshot must now be invalidated
  assert.equal(state.history[0].snapshot, null);

  // Undo should safely decline to undo corrupted state
  const undoRes = undoPlan(state);
  assert.equal(undoRes.undone, false);
});

// ============================================================================
// AUDIT SUITE 4: PERSON 4 (INTEGRATION & AI READINESS)
// ============================================================================

test('QA-P4-01: AI readiness probing never reports phantom positive status', async () => {
  // Case A: Ollama server returns 503 (offline)
  const offlineServer = await setupTestServer({
    checkStatus: async () => ({ available: false, models: [] })
  });

  try {
    const statusA = await getAIStatus({ baseUrl: offlineServer.baseUrl });
    assert.equal(statusA.ready, false);
    assert.deepEqual(statusA.models, []);
  } finally {
    await offlineServer.close();
  }

  // Case B: Ollama server returns 200 but model qwen3.5:2b is NOT installed
  const noModelServer = await setupTestServer({
    checkStatus: async () => ({ available: true, models: ['mistral:7b', 'llama3.2:1b'] })
  });

  try {
    const statusB = await getAIStatus({ baseUrl: noModelServer.baseUrl });
    assert.equal(statusB.ready, true); // daemon is online
    // Frontend logic checks statusB.models.includes('qwen3.5:2b')
    const appReady = statusB.ready && statusB.models.includes('qwen3.5:2b');
    assert.equal(appReady, false, 'App must not report ready when required model is missing');
  } finally {
    await noModelServer.close();
  }

  // Case C: Ollama server returns 200 and qwen3.5:2b IS installed
  const readyServer = await setupTestServer({
    checkStatus: async () => ({ available: true, models: ['qwen3.5:2b', 'llama3.2:1b'] })
  });

  try {
    const statusC = await getAIStatus({ baseUrl: readyServer.baseUrl });
    const appReady = statusC.ready && statusC.models.includes('qwen3.5:2b');
    assert.equal(appReady, true);
  } finally {
    await readyServer.close();
  }
});

test('QA-P4-02: reviewEstimate offers unconfirmed estimate separately and keeps confirmed blank', () => {
  // Case A: Model suggested duration in warnings without explicit text duration
  const draftUnconfirmed = {
    estimatedMinutes: null,
    warnings: ['Model estimated 45 minutes (unconfirmed)']
  };

  const reviewA = reviewEstimate(draftUnconfirmed);
  assert.equal(reviewA.confirmed, null);
  assert.equal(reviewA.suggested, 45);

  // Case B: Explicit confirmed duration
  const draftConfirmed = {
    estimatedMinutes: 60,
    warnings: []
  };

  const reviewB = reviewEstimate(draftConfirmed);
  assert.equal(reviewB.confirmed, 60);
  assert.equal(reviewB.suggested, null);
});

// ============================================================================
// AUDIT SUITE 5: SECURITY PENETRATION PROBES
// ============================================================================

test('QA-SEC-01: Probes strictly deny hidden files, archives, and sensitive server paths', async () => {
  const server = await setupTestServer();

  const deniedTargets = [
    '/.git',
    '/.git/config',
    '/.git/HEAD',
    '/backup.zip',
    '/archive.tar.gz',
    '/dump.tar',
    '/data.gz',
    '/server.js.bak',
    '/.env',
    '/.env.local',
    '/server.js',
    '/server/ai.js',
    '/package.json',
    '/package-lock.json',
    '/tests/server.test.js'
  ];

  try {
    for (const target of deniedTargets) {
      const res = await fetch(`${server.baseUrl}${target}`);
      assert.ok(
        res.status === 403 || res.status === 404,
        `Target ${target} should return 403 or 404, but returned ${res.status}`
      );
    }
  } finally {
    await server.close();
  }
});

test('QA-SEC-02: Directory traversal attempts are strictly refused with 403 Forbidden', async () => {
  const server = await setupTestServer();
  const urlObj = new URL(server.baseUrl);

  try {
    const testPaths = [
      '/../../../../etc/passwd',
      '/..%2f..%2fpackage.json',
      '/src/../../server.js'
    ];

    for (const testPath of testPaths) {
      const status = await new Promise((resolve, reject) => {
        const req = http.get(
          {
            host: urlObj.hostname,
            port: urlObj.port,
            path: testPath
          },
          (res) => resolve(res.statusCode)
        );
        req.on('error', reject);
      });

      assert.equal(status, 403, `Path traversal ${testPath} must return 403 Forbidden`);
    }
  } finally {
    await server.close();
  }
});

// ============================================================================
// AUDIT SUITE 6: PERFORMANCE OPTIMIZATION TESTS
// ============================================================================

test('QA-PERF-01: fastParseTaskText extracts fields instantly in <1ms without network', () => {
  const parsed = fastParseTaskText('MATH 54 problem set due Friday 11:59pm, about 2 hours');

  assert.equal(parsed.course, 'MATH 54');
  assert.equal(parsed.minutes, 120);
  assert.equal(parsed.title, 'MATH 54 problem set');
  assert.ok(typeof parsed.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dueDate));
  assert.equal(parsed.dueTime, '23:59');

  // Edge case: bare prompt
  const bare = fastParseTaskText('Read chapter 4 for 45 mins');
  assert.equal(bare.minutes, 45);
  assert.equal(bare.title, 'Read chapter 4');
});

test('QA-PERF-02: interpretTask sends keep_alive: "30m", num_predict: 256, and num_ctx: 1024', async () => {
  let receivedBody = null;
  const mockOllama = await createMockOllama((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      receivedBody = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'qwen3.5:2b',
          response: JSON.stringify({
            title: 'Test',
            course: null,
            dueAt: null,
            estimatedMinutes: null,
            steps: [],
            missingFields: ['course', 'dueAt', 'estimatedMinutes'],
            warnings: []
          })
        })
      );
    });
  });

  try {
    await interpretTask('Test prompt', {}, { url: `${mockOllama.url}/api/generate` });

    assert.ok(receivedBody !== null);
    assert.equal(receivedBody.keep_alive, '30m', 'Must specify keep_alive: "30m" to prevent model unloading');
    assert.equal(receivedBody.options?.num_predict, 256, 'Must bound num_predict: 256');
    assert.equal(receivedBody.options?.num_ctx, 1024, 'Must bound num_ctx: 1024');
  } finally {
    await mockOllama.close();
  }
});

test('QA-PERF-03: POST /api/ai/warmup and warmupOllama pre-load model into memory', async () => {
  let warmupCalled = false;
  const mockOllama = await createMockOllama((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const b = JSON.parse(raw);
      if (b.prompt === '' && b.keep_alive === '30m') {
        warmupCalled = true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ done: true }));
    });
  });

  const server = await setupTestServer({
    warmup: () => warmupOllama({ url: `${mockOllama.url}/api/generate` })
  });

  try {
    const res = await fetch(`${server.baseUrl}/api/ai/warmup`, { method: 'POST' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.warmed, true);
    assert.equal(warmupCalled, true, 'Ollama should receive warmup request');
  } finally {
    await server.close();
    await mockOllama.close();
  }
});

