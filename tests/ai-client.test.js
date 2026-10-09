import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  getAIStatus,
  interpretTask,
  AIClientError,
  AI_ERROR_CODES,
  AI_ERROR_MESSAGES
} from '../src/ai-client.js';

function createMockServer(handler) {
  const srv = http.createServer(handler);
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl,
        close: () => new Promise((res) => srv.close(res))
      });
    });
  });
}

test('getAIStatus returns ready: true and models list when server responds 200', async () => {
  const { baseUrl, close } = await createMockServer((req, res) => {
    assert.equal(req.url, '/api/ai/status');
    assert.equal(req.method, 'GET');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ available: true, models: ['llama3.2:1b'] }));
  });

  try {
    const status = await getAIStatus({ baseUrl });
    assert.deepEqual(status, {
      ready: true,
      models: ['llama3.2:1b'],
      error: null
    });
  } finally {
    await close();
  }
});

test('getAIStatus returns ready: false and error message when server responds 503', async () => {
  const { baseUrl, close } = await createMockServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ available: false, error: 'Ollama service unavailable on 127.0.0.1:11434' }));
  });

  try {
    const status = await getAIStatus({ baseUrl });
    assert.deepEqual(status, {
      ready: false,
      models: [],
      error: 'Ollama service unavailable on 127.0.0.1:11434'
    });
  } finally {
    await close();
  }
});

test('getAIStatus returns ready: false and diagnostic error when daemon is offline', async () => {
  // Use a port where no server is running
  const status = await getAIStatus({ baseUrl: 'http://127.0.0.1:59999' });
  assert.deepEqual(status, {
    ready: false,
    models: [],
    error: AI_ERROR_MESSAGES.OFFLINE
  });
});

test('interpretTask returns TaskDraft with draft and meta on success', async () => {
  const mockDraft = {
    title: 'Machine Problem 2',
    course: 'CS 150',
    dueAt: '2026-10-10T09:00:00.000Z',
    estimatedMinutes: 120,
    steps: [
      { title: 'Read specs', estimatedMinutes: 30 },
      { title: 'Implement', estimatedMinutes: 90 }
    ],
    missingFields: [],
    warnings: []
  };

  const { baseUrl, close } = await createMockServer((req, res) => {
    assert.equal(req.url, '/api/ai/interpret');
    assert.equal(req.method, 'POST');
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'x-model-used': 'llama3.2:1b',
      'x-latency-ms': '415'
    });
    res.end(JSON.stringify(mockDraft));
  });

  try {
    const result = await interpretTask('CS 150 MP2 due tomorrow at 5 PM', {}, { baseUrl });

    // Verify Draft Guarantee: includes draft and meta
    assert.deepEqual(result.draft, mockDraft);
    assert.deepEqual(result.meta, {
      modelUsed: 'llama3.2:1b',
      latencyMs: 415
    });

    // Also directly accessible as TaskDraft
    assert.equal(result.title, 'Machine Problem 2');
    assert.equal(result.course, 'CS 150');
    assert.equal(result.dueAt, '2026-10-10T09:00:00.000Z');
    assert.equal(result.estimatedMinutes, 120);
    assert.equal(result.steps.length, 2);
  } finally {
    await close();
  }
});

test('interpretTask maps 503 to OFFLINE diagnostic error', async () => {
  const { baseUrl, close } = await createMockServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Ollama offline' }));
  });

  try {
    await assert.rejects(
      async () => {
        await interpretTask('Math homework', {}, { baseUrl });
      },
      (err) => {
        assert.ok(err instanceof AIClientError);
        assert.equal(err.code, AI_ERROR_CODES.OFFLINE);
        assert.equal(err.message, AI_ERROR_MESSAGES.OFFLINE);
        return true;
      }
    );
  } finally {
    await close();
  }
});

test('interpretTask maps 504 to TIMEOUT diagnostic error', async () => {
  const { baseUrl, close } = await createMockServer((req, res) => {
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Timed out' }));
  });

  try {
    await assert.rejects(
      async () => {
        await interpretTask('Math homework', {}, { baseUrl });
      },
      (err) => {
        assert.ok(err instanceof AIClientError);
        assert.equal(err.code, AI_ERROR_CODES.TIMEOUT);
        assert.equal(err.message, AI_ERROR_MESSAGES.TIMEOUT);
        return true;
      }
    );
  } finally {
    await close();
  }
});

test('interpretTask maps 502 to MALFORMED_OUTPUT diagnostic error', async () => {
  const { baseUrl, close } = await createMockServer((req, res) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Model output invalid' }));
  });

  try {
    await assert.rejects(
      async () => {
        await interpretTask('Math homework', {}, { baseUrl });
      },
      (err) => {
        assert.ok(err instanceof AIClientError);
        assert.equal(err.code, AI_ERROR_CODES.MALFORMED_OUTPUT);
        assert.equal(err.message, AI_ERROR_MESSAGES.MALFORMED_OUTPUT);
        return true;
      }
    );
  } finally {
    await close();
  }
});

test('interpretTask supports user-triggered cancellation via AbortSignal', async () => {
  const controller = new AbortController();
  const { baseUrl, close } = await createMockServer((req, res) => {
    // Hangs
  });

  try {
    const promise = interpretTask('Problem set', {}, {
      baseUrl,
      signal: controller.signal
    });
    controller.abort(new Error('User cancelled capture'));
    await assert.rejects(promise, (err) => {
      assert.equal(err.message, 'User cancelled capture');
      return true;
    });
  } finally {
    await close();
  }
});

test('interpretTask validates non-empty text input before making network request', async () => {
  await assert.rejects(
    async () => {
      await interpretTask('   ');
    },
    (err) => {
      assert.ok(err instanceof AIClientError);
      assert.equal(err.code, AI_ERROR_CODES.INVALID_REQUEST);
      return true;
    }
  );
});
