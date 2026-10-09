import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../server.js';
import {
  checkOllamaStatus,
  interpretTask,
  OllamaOfflineError,
  TimeoutError,
  ModelOutputError,
  TaskDraftSchema,
  DEFAULT_MODEL,
  DEFAULT_TIMEZONE
} from '../server/ai.js';

/**
 * Creates an ephemeral mock Ollama server for deterministic testing.
 */
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

/**
 * Creates an ephemeral test instance of the application HTTP server from server.js.
 * Plugs into the mock Ollama instance for end-to-end integration testing.
 */
function createTestAppServer({ ollamaUrl, interpretTimeoutMs = 10_000 } = {}) {
  const app = createServer({
    root: process.cwd(),
    interpret: (text, context, opts) => {
      const options = { ...opts };
      if (ollamaUrl) options.url = `${ollamaUrl}/api/generate`;
      if (interpretTimeoutMs) options.timeoutMs = interpretTimeoutMs;
      return interpretTask(text, context, options);
    },
    checkStatus: (opts) => {
      const options = { ...opts };
      if (ollamaUrl) options.url = `${ollamaUrl}/api/tags`;
      return checkOllamaStatus(options);
    }
  });

  return new Promise((resolve) => {
    app.listen(0, '127.0.0.1', () => {
      const port = app.address().port;
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => app.close(res))
      });
    });
  });
}

// ============================================================================
// Matrix 1: Successful Extraction
// ============================================================================

test('Successful extraction: mock valid Ollama JSON response, verify fields, x-model-used, and x-latency-ms', async () => {
  const expectedTaskDraft = {
    title: 'Problem Set 4',
    course: 'MATH 54',
    dueAt: '2026-10-10T15:59:00.000Z',
    estimatedMinutes: 120,
    steps: [
      { title: 'Review lecture notes and definitions', estimatedMinutes: 30 },
      { title: 'Solve problems 1 through 5', estimatedMinutes: 60 },
      { title: 'Check solutions and format proofs', estimatedMinutes: 30 }
    ],
    missingFields: [],
    warnings: []
  };

  const mockOllama = await createMockOllama((req, res) => {
    assert.equal(req.url, '/api/generate');
    assert.equal(req.method, 'POST');

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsedBody = JSON.parse(body);
      assert.equal(parsedBody.format, 'json');
      assert.equal(parsedBody.stream, false);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'llama3.2:1b',
          response: JSON.stringify(expectedTaskDraft)
        })
      );
    });
  });

  const appServer = await createTestAppServer({ ollamaUrl: mockOllama.url });

  try {
    const res = await fetch(`${appServer.url}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'MATH 54 Problem Set 4 due Saturday 11:59 PM, about 2 hours',
        context: {
          currentDate: '2026-10-09T15:00:00.000Z',
          timezone: 'Asia/Manila'
        }
      })
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.equal(res.headers.get('x-model-used'), 'llama3.2:1b');

    const latencyHeader = res.headers.get('x-latency-ms');
    assert.ok(latencyHeader != null, 'x-latency-ms header must be present');
    assert.ok(!Number.isNaN(Number(latencyHeader)), 'x-latency-ms header must be a number');

    const draft = await res.json();
    assert.equal(draft.title, 'Problem Set 4');
    assert.equal(draft.course, 'MATH 54');
    assert.equal(draft.dueAt, '2026-10-10T15:59:00.000Z');
    assert.equal(draft.estimatedMinutes, 120);
    assert.equal(draft.steps.length, 3);
    assert.deepEqual(draft.missingFields, []);
    assert.deepEqual(draft.warnings, []);

    // Verify draft strictly matches the TaskDraftSchema contract
    const validation = TaskDraftSchema.safeParse(draft);
    assert.ok(validation.success, 'Output must conform to TaskDraft contract');
  } finally {
    await appServer.close();
    await mockOllama.close();
  }
});

// ============================================================================
// Matrix 2 & 3: Missing Fields (dueAt and estimatedMinutes)
// ============================================================================

test('Missing fields: prompt without a deadline returns dueAt: null and includes "dueAt" in missingFields', async () => {
  const mockOllama = await createMockOllama((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        model: 'llama3.2:1b',
        response: JSON.stringify({
          title: 'Review CS notes',
          course: 'CS 101',
          dueAt: null,
          estimatedMinutes: 60,
          steps: [
            { title: 'Read lecture slides', estimatedMinutes: 30 },
            { title: 'Summarize key points', estimatedMinutes: 30 }
          ],
          missingFields: ['dueAt'],
          warnings: []
        })
      })
    );
  });

  const appServer = await createTestAppServer({ ollamaUrl: mockOllama.url });

  try {
    const res = await fetch(`${appServer.url}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Review CS notes for 1 hour' })
    });

    assert.equal(res.status, 200);
    const draft = await res.json();

    assert.equal(draft.title, 'Review CS notes');
    assert.equal(draft.dueAt, null);
    assert.ok(
      draft.missingFields.includes('dueAt'),
      'missingFields must contain "dueAt" when deadline is omitted'
    );
  } finally {
    await appServer.close();
    await mockOllama.close();
  }
});

test('Missing duration: prompt without duration returns estimatedMinutes: null and includes "estimatedMinutes" in missingFields', async () => {
  const mockOllama = await createMockOllama((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        model: 'llama3.2:1b',
        response: JSON.stringify({
          title: 'Read chapter 4 of biology textbook',
          course: null,
          dueAt: null,
          estimatedMinutes: null,
          steps: [
            { title: 'Skim section headings', estimatedMinutes: 15 },
            { title: 'Read text thoroughly', estimatedMinutes: 45 },
            { title: 'Take outline notes', estimatedMinutes: 20 }
          ],
          missingFields: ['course', 'dueAt', 'estimatedMinutes'],
          warnings: []
        })
      })
    );
  });

  const appServer = await createTestAppServer({ ollamaUrl: mockOllama.url });

  try {
    const res = await fetch(`${appServer.url}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Read chapter 4 of biology textbook' })
    });

    assert.equal(res.status, 200);
    const draft = await res.json();

    assert.equal(draft.estimatedMinutes, null);
    assert.ok(
      draft.missingFields.includes('estimatedMinutes'),
      'missingFields must contain "estimatedMinutes" when duration is omitted'
    );
    assert.equal(draft.dueAt, null);
    assert.ok(draft.missingFields.includes('dueAt'));
    assert.equal(draft.course, null);
    assert.ok(draft.missingFields.includes('course'));
  } finally {
    await appServer.close();
    await mockOllama.close();
  }
});

// ============================================================================
// Matrix 4: Task Decomposition
// ============================================================================

test('Task decomposition: verify steps array contains 2-4 parsed sub-steps with minutes', async () => {
  const mockOllama = await createMockOllama((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        model: 'llama3.2:1b',
        response: JSON.stringify({
          title: 'Essay Draft on Modern History',
          course: 'HIST 1',
          dueAt: null,
          estimatedMinutes: 90,
          steps: [
            { title: 'Outline primary sources and thesis', estimatedMinutes: 20 },
            { title: 'Draft introduction and body paragraphs', estimatedMinutes: 50 },
            { title: 'Proofread and edit citations', estimatedMinutes: 20 }
          ],
          missingFields: ['dueAt'],
          warnings: []
        })
      })
    );
  });

  const appServer = await createTestAppServer({ ollamaUrl: mockOllama.url });

  try {
    const res = await fetch(`${appServer.url}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Essay Draft on Modern History, 90 mins' })
    });

    assert.equal(res.status, 200);
    const draft = await res.json();

    assert.ok(Array.isArray(draft.steps));
    assert.ok(
      draft.steps.length >= 2 && draft.steps.length <= 4,
      `Decomposed steps count (${draft.steps.length}) must be between 2 and 4`
    );

    for (const step of draft.steps) {
      assert.equal(typeof step.title, 'string');
      assert.ok(step.title.trim().length > 0, 'Step title must be non-empty');
      assert.equal(typeof step.estimatedMinutes, 'number');
      assert.ok(step.estimatedMinutes > 0, 'Step estimatedMinutes must be positive number');
    }
  } finally {
    await appServer.close();
    await mockOllama.close();
  }
});

// ============================================================================
// Matrix 5: Malformed Model Output -> HTTP 502
// ============================================================================

test('Malformed model output: Ollama returning non-JSON or schema violation returns HTTP 502', async () => {
  // Case A: Ollama response is not valid JSON
  const mockOllamaNonJson = await createMockOllama((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ response: 'Invalid output: { not-json...' }));
  });

  const appServerNonJson = await createTestAppServer({ ollamaUrl: mockOllamaNonJson.url });

  try {
    const res = await fetch(`${appServerNonJson.url}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Math homework' })
    });

    assert.equal(res.status, 502, 'Expected HTTP 502 for non-JSON model output');
    const data = await res.json();
    assert.ok(typeof data.error === 'string');
  } finally {
    await appServerNonJson.close();
    await mockOllamaNonJson.close();
  }

  // Case B: Ollama response is JSON but violates required contract schema
  const mockOllamaBadSchema = await createMockOllama((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        response: JSON.stringify({
          title: '', // Empty title violates schema
          steps: 'invalid-steps-format' // Must be an array
        })
      })
    );
  });

  const appServerBadSchema = await createTestAppServer({ ollamaUrl: mockOllamaBadSchema.url });

  try {
    const res = await fetch(`${appServerBadSchema.url}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Math homework' })
    });

    assert.equal(res.status, 502, 'Expected HTTP 502 for schema-violating model output');
    const data = await res.json();
    assert.ok(typeof data.error === 'string');
  } finally {
    await appServerBadSchema.close();
    await mockOllamaBadSchema.close();
  }
});

// ============================================================================
// Matrix 6: Absent Model / Service Down -> HTTP 503
// ============================================================================

test('Absent model / service down: ECONNREFUSED returns HTTP 503 on interpret and status endpoints', async () => {
  // Use port 59999 where no service is listening to trigger ECONNREFUSED
  const offlineOllamaUrl = 'http://127.0.0.1:59999';
  const appServer = await createTestAppServer({ ollamaUrl: offlineOllamaUrl });

  try {
    // 1. POST /api/ai/interpret
    const interpretRes = await fetch(`${appServer.url}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Review lecture notes' })
    });

    assert.equal(interpretRes.status, 503, 'Expected HTTP 503 when Ollama is offline');
    const interpretData = await interpretRes.json();
    assert.ok(typeof interpretData.error === 'string');

    // 2. GET /api/ai/status
    const statusRes = await fetch(`${appServer.url}/api/ai/status`);
    assert.equal(statusRes.status, 503, 'Expected HTTP 503 on status check when Ollama is offline');
    const statusData = await statusRes.json();
    assert.deepEqual(statusData, {
      available: false,
      error: 'Ollama service unavailable on 127.0.0.1:11434'
    });
  } finally {
    await appServer.close();
  }
});

// ============================================================================
// Matrix 7: Timeout Handling -> HTTP 504
// ============================================================================

test('Timeout handling: delayed response exceeding timeout limit returns HTTP 504', async () => {
  const mockOllamaHanging = await createMockOllama((req, res) => {
    // Intentionally never respond to trigger a timeout
  });

  const appServer = await createTestAppServer({
    ollamaUrl: mockOllamaHanging.url,
    interpretTimeoutMs: 50 // 50ms short timeout for deterministic test
  });

  try {
    const res = await fetch(`${appServer.url}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Review lecture notes' })
    });

    assert.equal(res.status, 504, 'Expected HTTP 504 when model extraction times out');
    const data = await res.json();
    assert.ok(typeof data.error === 'string');
    assert.ok(data.error.includes('timed out'));
  } finally {
    await appServer.close();
    await mockOllamaHanging.close();
  }
});

// ============================================================================
// Matrix 8: Static File Security (403/404)
// ============================================================================

test('Static file security: verify GET /.git/config and GET /archive.zip return 403 or 404', async () => {
  const appServer = await createTestAppServer();

  try {
    // Required forbidden checks: /.git/config and /archive.zip
    const resGitConfig = await fetch(`${appServer.url}/.git/config`);
    assert.ok(
      resGitConfig.status === 403 || resGitConfig.status === 404,
      `Expected 403 or 404 for /.git/config, got ${resGitConfig.status}`
    );

    const resArchiveZip = await fetch(`${appServer.url}/archive.zip`);
    assert.ok(
      resArchiveZip.status === 403 || resArchiveZip.status === 404,
      `Expected 403 or 404 for /archive.zip, got ${resArchiveZip.status}`
    );

    // Additional denied asset protections
    const additionalDenied = [
      '/.git',
      '/.git/HEAD',
      '/.env',
      '/.env.local',
      '/.env.production',
      '/backup.tar',
      '/data.gz',
      '/config.bak',
      '/package.json.bak'
    ];

    for (const urlPath of additionalDenied) {
      const res = await fetch(`${appServer.url}${urlPath}`);
      assert.ok(
        res.status === 403 || res.status === 404,
        `Expected 403 or 404 for ${urlPath}, got ${res.status}`
      );
    }

    // Verify legitimate asset serving remains intact
    const resIndex = await fetch(`${appServer.url}/index.html`);
    assert.equal(resIndex.status, 200);

    const resAppJs = await fetch(`${appServer.url}/src/app.js`);
    assert.equal(resAppJs.status, 200);
  } finally {
    await appServer.close();
  }
});

// ============================================================================
// Direct Unit Tests for server/ai.js
// ============================================================================

test('Unit test: checkOllamaStatus parses models list when daemon is active', async () => {
  const mockOllama = await createMockOllama((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        models: [
          { name: 'llama3.2:1b', model: 'llama3.2:1b' },
          { name: 'mistral:latest', model: 'mistral:latest' }
        ]
      })
    );
  });

  try {
    const status = await checkOllamaStatus({ url: `${mockOllama.url}/api/tags` });
    assert.equal(status.available, true);
    assert.deepEqual(status.models, ['llama3.2:1b', 'mistral:latest']);
  } finally {
    await mockOllama.close();
  }
});

test('Unit test: interpretTask validates input and respects upstream cancellation signal', async () => {
  // Empty text check
  await assert.rejects(
    async () => {
      await interpretTask('   ');
    },
    (err) => {
      assert.ok(err instanceof ModelOutputError);
      return true;
    }
  );

  // Cancellation signal check
  const controller = new AbortController();
  const mockOllamaHanging = await createMockOllama((req, res) => {});

  try {
    const promise = interpretTask('Problem set', {}, {
      url: `${mockOllamaHanging.url}/api/generate`,
      signal: controller.signal
    });
    controller.abort(new Error('User cancelled capture'));
    await assert.rejects(promise, (err) => {
      assert.equal(err.message, 'User cancelled capture');
      return true;
    });
  } finally {
    await mockOllamaHanging.close();
  }
});
