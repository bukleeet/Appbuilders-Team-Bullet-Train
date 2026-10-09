import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../server.js';
import { OllamaOfflineError, TimeoutError, ModelOutputError } from '../server/ai.js';

function setupTestServer(options = {}) {
  const srv = createServer(options);
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl,
        close: () => new Promise((res) => srv.close(res))
      });
    });
  });
}

test('GET /api/ai/status returns 200 when Ollama is available', async () => {
  const { baseUrl, close } = await setupTestServer({
    checkStatus: async () => ({ available: true, models: ['qwen3.5:2b'] })
  });

  try {
    const res = await fetch(`${baseUrl}/api/ai/status`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    const data = await res.json();
    assert.deepEqual(data, { available: true, models: ['qwen3.5:2b'] });
  } finally {
    await close();
  }
});

test('GET /api/ai/status returns 503 when Ollama is unavailable', async () => {
  const { baseUrl, close } = await setupTestServer({
    checkStatus: async () => ({ available: false, models: [] })
  });

  try {
    const res = await fetch(`${baseUrl}/api/ai/status`);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('content-type'), 'application/json');
    const data = await res.json();
    assert.deepEqual(data, {
      available: false,
      error: 'Ollama service unavailable on 127.0.0.1:11434'
    });
  } finally {
    await close();
  }
});

test('POST /api/ai/status returns 405 Method Not Allowed', async () => {
  const { baseUrl, close } = await setupTestServer();

  try {
    const res = await fetch(`${baseUrl}/api/ai/status`, { method: 'POST' });
    assert.equal(res.status, 405);
  } finally {
    await close();
  }
});

test('POST /api/ai/interpret returns 200 with headers and TaskDraft on success', async () => {
  const expectedDraft = {
    title: 'Math PS 4',
    course: 'MATH 54',
    dueAt: '2026-10-10T15:59:00.000Z',
    estimatedMinutes: 120,
    steps: [
      { title: 'Step 1', estimatedMinutes: 60 },
      { title: 'Step 2', estimatedMinutes: 60 }
    ],
    missingFields: [],
    warnings: []
  };

  const { baseUrl, close } = await setupTestServer({
    interpret: async (text, context) => ({
      draft: expectedDraft,
      modelUsed: 'qwen3.5:2b',
      latencyMs: 342
    })
  });

  try {
    const res = await fetch(`${baseUrl}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Math problem set due Saturday 11:59 PM, 2 hours',
        context: { currentDate: '2026-10-09T15:00:00.000Z' }
      })
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.equal(res.headers.get('x-model-used'), 'qwen3.5:2b');
    assert.equal(res.headers.get('x-latency-ms'), '342');

    const data = await res.json();
    assert.deepEqual(data, expectedDraft);
  } finally {
    await close();
  }
});

test('POST /api/ai/interpret returns 400 on malformed JSON or invalid text', async () => {
  const { baseUrl, close } = await setupTestServer();

  try {
    // Malformed JSON
    const res1 = await fetch(`${baseUrl}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json{'
    });
    assert.equal(res1.status, 400);

    // Missing text
    const res2 = await fetch(`${baseUrl}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: {} })
    });
    assert.equal(res2.status, 400);

    // Empty text
    const res3 = await fetch(`${baseUrl}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' })
    });
    assert.equal(res3.status, 400);
  } finally {
    await close();
  }
});

test('POST /api/ai/interpret returns 503 on OllamaOfflineError', async () => {
  const { baseUrl, close } = await setupTestServer({
    interpret: async () => {
      throw new OllamaOfflineError('Ollama daemon connection refused');
    }
  });

  try {
    const res = await fetch(`${baseUrl}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Read chapter 4' })
    });

    assert.equal(res.status, 503);
    const data = await res.json();
    assert.equal(data.error, 'Ollama daemon connection refused');
  } finally {
    await close();
  }
});

test('POST /api/ai/interpret returns 504 on TimeoutError', async () => {
  const { baseUrl, close } = await setupTestServer({
    interpret: async () => {
      throw new TimeoutError('Inference timed out after 10000ms');
    }
  });

  try {
    const res = await fetch(`${baseUrl}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Read chapter 4' })
    });

    assert.equal(res.status, 504);
    const data = await res.json();
    assert.equal(data.error, 'Inference timed out after 10000ms');
  } finally {
    await close();
  }
});

test('POST /api/ai/interpret returns 502 on ModelOutputError', async () => {
  const { baseUrl, close } = await setupTestServer({
    interpret: async () => {
      throw new ModelOutputError('Model produced non-JSON output');
    }
  });

  try {
    const res = await fetch(`${baseUrl}/api/ai/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Read chapter 4' })
    });

    assert.equal(res.status, 502);
    const data = await res.json();
    assert.equal(data.error, 'Model produced non-JSON output');
  } finally {
    await close();
  }
});

test('Static Asset: serves index.html and assets with proper mime types', async () => {
  const { baseUrl, close } = await setupTestServer();

  try {
    // GET /
    const resRoot = await fetch(`${baseUrl}/`);
    assert.equal(resRoot.status, 200);
    assert.ok(resRoot.headers.get('content-type')?.includes('text/html'));
    const htmlText = await resRoot.text();
    assert.ok(htmlText.includes('<!DOCTYPE html>') || htmlText.includes('<html'));

    // GET /src/app.js
    const resApp = await fetch(`${baseUrl}/src/app.js`);
    assert.equal(resApp.status, 200);
    assert.ok(resApp.headers.get('content-type')?.includes('text/javascript'));

    // GET /src/styles.css
    const resCss = await fetch(`${baseUrl}/src/styles.css`);
    assert.equal(resCss.status, 200);
    assert.ok(resCss.headers.get('content-type')?.includes('text/css'));
  } finally {
    await close();
  }
});

test('Static Asset Security: denies access to .git, .env*, and archive/backup files', async () => {
  const { baseUrl, close } = await setupTestServer();

  try {
    const deniedUrls = [
      '/.git',
      '/.git/config',
      '/.git/HEAD',
      '/.env',
      '/.env.local',
      '/.env.production',
      '/test.zip',
      '/data.tar',
      '/backup.gz',
      '/server.js.bak',
      '/package.json.bak',
      '/src/.env',
      '/sub/.git/config',
      '/archive.tar.gz'
    ];

    for (const deniedUrl of deniedUrls) {
      const res = await fetch(`${baseUrl}${deniedUrl}`);
      assert.equal(
        res.status,
        403,
        `Expected 403 Forbidden for ${deniedUrl}, but got ${res.status}`
      );
    }
  } finally {
    await close();
  }
});

test('Static Asset Security: denies path traversal attempts', async () => {
  const { baseUrl, close } = await setupTestServer();
  const urlObj = new URL(baseUrl);

  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: urlObj.hostname,
          port: urlObj.port,
          path: '/../../../../etc/passwd'
        },
        (res) => {
          resolve(res.statusCode);
        }
      );
      req.on('error', reject);
    });

    assert.equal(status, 403);
  } finally {
    await close();
  }
});

test('Static Asset: returns 404 for nonexistent files', async () => {
  const { baseUrl, close } = await setupTestServer();

  try {
    const res = await fetch(`${baseUrl}/nonexistent-file-12345.xyz`);
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});
