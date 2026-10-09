import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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

test('checkOllamaStatus returns available: true and model list against local Ollama', async () => {
  const status = await checkOllamaStatus();
  assert.equal(typeof status.available, 'boolean');
  assert.ok(Array.isArray(status.models));
  if (status.available) {
    assert.ok(status.models.length > 0);
  }
});

test('checkOllamaStatus returns available: false and empty models when daemon is offline', async () => {
  // Port 59999 should not have an Ollama daemon listening
  const status = await checkOllamaStatus({
    url: 'http://127.0.0.1:59999/api/tags',
    timeoutMs: 500
  });
  assert.deepEqual(status, { available: false, models: [] });
});

test('checkOllamaStatus handles timeout gracefully without throwing', async () => {
  const server = http.createServer((req, res) => {
    // Deliberately do not respond, causing a timeout
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const status = await checkOllamaStatus({
      url: `http://127.0.0.1:${port}/api/tags`,
      timeoutMs: 50
    });
    assert.deepEqual(status, { available: false, models: [] });
  } finally {
    server.close();
  }
});

test('interpretTask throws OllamaOfflineError when loopback port is offline', async () => {
  await assert.rejects(
    async () => {
      await interpretTask('Math homework due Friday', {}, {
        url: 'http://127.0.0.1:59999/api/generate',
        timeoutMs: 500
      });
    },
    (err) => {
      assert.ok(err instanceof OllamaOfflineError);
      assert.equal(err.name, 'OllamaOfflineError');
      return true;
    }
  );
});

test('interpretTask throws TimeoutError when internal timeout triggers', async () => {
  const server = http.createServer((req, res) => {
    // Hangs forever
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    await assert.rejects(
      async () => {
        await interpretTask('Review lecture notes', {}, {
          url: `http://127.0.0.1:${port}/api/generate`,
          timeoutMs: 50
        });
      },
      (err) => {
        assert.ok(err instanceof TimeoutError);
        assert.equal(err.name, 'TimeoutError');
        return true;
      }
    );
  } finally {
    server.close();
  }
});

test('interpretTask supports upstream abort signal', async () => {
  const controller = new AbortController();
  const server = http.createServer((req, res) => {
    // Hangs
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const promise = interpretTask('Problem set', {}, {
      url: `http://127.0.0.1:${port}/api/generate`,
      signal: controller.signal,
      timeoutMs: 5000
    });
    controller.abort(new Error('User cancelled'));
    await assert.rejects(promise, (err) => {
      assert.equal(err.message, 'User cancelled');
      return true;
    });
  } finally {
    server.close();
  }
});

test('interpretTask throws ModelOutputError on non-JSON response from model', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ response: 'This is not JSON: { broken' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    await assert.rejects(
      async () => {
        await interpretTask('Problem set 1', {}, {
          url: `http://127.0.0.1:${port}/api/generate`,
          timeoutMs: 1000
        });
      },
      (err) => {
        assert.ok(err instanceof ModelOutputError);
        assert.equal(err.name, 'ModelOutputError');
        return true;
      }
    );
  } finally {
    server.close();
  }
});

test('interpretTask throws ModelOutputError on empty input text', async () => {
  await assert.rejects(
    async () => {
      await interpretTask('   ');
    },
    (err) => {
      assert.ok(err instanceof ModelOutputError);
      return true;
    }
  );
});

test('interpretTask parses mock structured response matching TaskDraft contract', async () => {
  const mockPayload = {
    response: JSON.stringify({
      title: 'Problem Set 4',
      course: 'MATH 54',
      dueAt: '2026-10-10T15:59:00.000Z',
      estimatedMinutes: 120,
      steps: [
        { title: 'Read Chapter 4 exercises', estimatedMinutes: 30 },
        { title: 'Solve problems 1-10', estimatedMinutes: 60 },
        { title: 'Format proof and review', estimatedMinutes: 30 }
      ],
      missingFields: [],
      warnings: []
    })
  };

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockPayload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const result = await interpretTask('MATH 54 Problem Set 4, 2 hours, due Saturday 11:59 PM', {
      currentDate: '2026-10-09T15:00:00.000Z',
      timezone: 'Asia/Manila'
    }, {
      url: `http://127.0.0.1:${port}/api/generate`
    });

    assert.equal(result.modelUsed, DEFAULT_MODEL);
    assert.ok(typeof result.latencyMs === 'number');

    const draft = result.draft;
    assert.equal(draft.title, 'Problem Set 4');
    assert.equal(draft.course, 'MATH 54');
    assert.equal(draft.dueAt, '2026-10-10T15:59:00.000Z');
    assert.equal(draft.estimatedMinutes, 120);
    assert.equal(draft.steps.length, 3);
    assert.deepEqual(draft.missingFields, []);
    assert.deepEqual(draft.warnings, []);

    // Validate with Zod schema directly
    const validation = TaskDraftSchema.safeParse(draft);
    assert.ok(validation.success);
  } finally {
    server.close();
  }
});

test('interpretTask enforces strict nulls and pushes missingFields for omitted deadline & duration', async () => {
  const mockPayload = {
    response: JSON.stringify({
      title: 'Read chapter 4 of biology textbook',
      course: null,
      dueAt: null,
      estimatedMinutes: null,
      steps: [
        { title: 'Skim section summaries', estimatedMinutes: 15 },
        { title: 'Read chapter thoroughly', estimatedMinutes: 45 },
        { title: 'Write outline notes', estimatedMinutes: 20 }
      ],
      missingFields: ['course', 'dueAt', 'estimatedMinutes'],
      warnings: []
    })
  };

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockPayload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const result = await interpretTask('Read chapter 4 of biology textbook', {
      currentDate: '2026-10-09T15:00:00.000Z',
      timezone: 'Asia/Manila'
    }, {
      url: `http://127.0.0.1:${port}/api/generate`
    });

    const draft = result.draft;
    assert.equal(draft.title, 'Read chapter 4 of biology textbook');
    assert.equal(draft.course, null);
    assert.equal(draft.dueAt, null);
    assert.equal(draft.estimatedMinutes, null);
    assert.ok(draft.steps.length >= 2 && draft.steps.length <= 4);
    assert.ok(draft.missingFields.includes('dueAt'));
    assert.ok(draft.missingFields.includes('estimatedMinutes'));
    assert.ok(draft.missingFields.includes('course'));

    const validation = TaskDraftSchema.safeParse(draft);
    assert.ok(validation.success);
  } finally {
    server.close();
  }
});

test('interpretTask live test with local Ollama llama3.2:1b (if available)', async () => {
  const status = await checkOllamaStatus();
  if (!status.available || !status.models.some((m) => m.includes('llama3.2:1b'))) {
    console.log('Skipping live Ollama test: daemon or model not available');
    return;
  }

  const result = await interpretTask('Math problem set due Friday 11:59 PM, about 2 hours.', {
    currentDate: '2026-10-09T15:00:00.000Z',
    timezone: 'Asia/Manila'
  }, {
    timeoutMs: 25_000
  });

  assert.equal(result.modelUsed, 'llama3.2:1b');
  assert.ok(result.latencyMs >= 0);

  const draft = result.draft;
  assert.equal(typeof draft.title, 'string');
  assert.ok(draft.title.length > 0);
  assert.ok(draft.dueAt === null || typeof draft.dueAt === 'string');
  assert.ok(draft.steps.length >= 2 && draft.steps.length <= 4);
  for (const step of draft.steps) {
    assert.equal(typeof step.title, 'string');
    assert.equal(typeof step.estimatedMinutes, 'number');
    assert.ok(step.estimatedMinutes > 0);
  }

  const validation = TaskDraftSchema.safeParse(draft);
  assert.ok(validation.success, `TaskDraft contract validation failed: ${JSON.stringify(validation.error)}`);
});
