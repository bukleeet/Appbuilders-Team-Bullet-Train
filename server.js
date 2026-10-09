import http from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkOllamaStatus,
  interpretTask,
  warmupOllama,
  OllamaOfflineError,
  TimeoutError,
  ModelOutputError
} from './server/ai.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * Checks whether a requested URL pathname or resolved filesystem path
 * matches explicitly denied patterns:
 * - .git
 * - .env*
 * - archive/backup files (*.zip, *.tar, *.gz, *.bak)
 */
export function isDeniedPath(pathname, filePath) {
  const normPath = pathname.replace(/\\/g, '/');

  // Explicitly deny .git directories or files
  if (/(?:^|\/)\.git(?:\/|$)/i.test(normPath)) return true;

  // Explicitly deny .env and .env.* files
  if (/(?:^|\/)\.env(?:[^/]*)(?:\/|$)/i.test(normPath)) return true;

  // Explicitly deny archive and backup files (*.zip, *.tar, *.gz, *.bak)
  if (/\.(zip|tar|gz|bak)$/i.test(normPath)) return true;

  // Explicitly deny server source, tests, node_modules, and package manifests
  if (/(?:^|\/)(server|tests|node_modules)(?:\/|$)/i.test(normPath)) return true;
  if (/(?:^|\/)package(?:-lock)?\.json$/i.test(normPath)) return true;

  if (filePath) {
    const base = path.basename(filePath).toLowerCase();
    if (base === '.git' || base.startsWith('.env') || /\.(zip|tar|gz|bak)$/i.test(base)) {
      return true;
    }
    if (base === 'package.json' || base === 'package-lock.json') {
      return true;
    }
  }

  return false;
}

/**
 * Validates whether a requested static path is an allowed frontend application asset.
 * Enforces an explicit allowlist:
 * - / and /index.html
 * - /src/** (.js, .css, .json, .mjs)
 * - /public/** (.svg, .png, .jpg, .jpeg, .ico, .woff, .woff2, etc.)
 * - /docs/design/** (.png, .jpg, .jpeg, .svg)
 */
export function isAllowedStaticPath(pathname) {
  const normPath = pathname.replace(/\\/g, '/');

  // Denials always take precedence
  if (isDeniedPath(normPath)) return false;

  // Root landing page
  if (normPath === '/' || normPath === '/index.html') return true;

  // Application source code and styles
  if (/^\/src\/[a-zA-Z0-9_\-./]+\.(js|css|json|mjs)$/i.test(normPath)) return true;

  // Public assets (icons, images, fonts)
  if (/^\/public\/[a-zA-Z0-9_\-./]+\.(svg|png|jpg|jpeg|ico|woff|woff2|css|js|txt)$/i.test(normPath)) return true;

  // Design preview assets
  if (/^\/docs\/design\/[a-zA-Z0-9_\-./]+\.(png|jpg|jpeg|svg)$/i.test(normPath)) return true;

  return false;
}

/**
 * Creates the HTTP server instance.
 * Allows dependency injection of root directory and AI helpers for testing.
 */
export function createServer({
  root = process.cwd(),
  checkStatus = checkOllamaStatus,
  interpret = interpretTask,
  warmup = warmupOllama
} = {}) {
  return http.createServer(async (req, res) => {
    const rawUrl = req.url || '';
    if (rawUrl.includes('..') || rawUrl.toLowerCase().includes('%2e%2e')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad Request');
      return;
    }

    // -------------------------------------------------------------
    // Endpoint: POST /api/ai/warmup
    // -------------------------------------------------------------
    if (pathname === '/api/ai/warmup') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({ error: 'Method Not Allowed' })
        );
        return;
      }

      try {
        const result = await warmup();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result || { warmed: true }));
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ warmed: false }));
      }
      return;
    }

    // -------------------------------------------------------------
    // Endpoint: GET /api/ai/status
    // -------------------------------------------------------------
    if (pathname === '/api/ai/status') {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({ error: 'Method Not Allowed' })
        );
        return;
      }

      try {
        const status = await checkStatus();
        if (status && status.available) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(status));
        } else {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              available: false,
              error: 'Ollama service unavailable on 127.0.0.1:11434'
            })
          );
        }
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            available: false,
            error: 'Ollama service unavailable on 127.0.0.1:11434'
          })
        );
      }
      return;
    }

    // -------------------------------------------------------------
    // Endpoint: POST /api/ai/interpret
    // -------------------------------------------------------------
    if (pathname === '/api/ai/interpret') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({ error: 'Method Not Allowed' })
        );
        return;
      }

      let bodyStr = '';
      let isTooLarge = false;

      req.on('data', (chunk) => {
        bodyStr += chunk;
        if (bodyStr.length > 1_000_000 && !isTooLarge) {
          isTooLarge = true;
          res.writeHead(413, { 'Content-Type': 'application/json' }).end(
            JSON.stringify({ error: 'Payload Too Large' })
          );
          req.destroy();
        }
      });

      req.on('end', async () => {
        if (isTooLarge) return;

        let body;
        try {
          body = JSON.parse(bodyStr);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON request body' }));
          return;
        }

        if (!body || typeof body !== 'object' || typeof body.text !== 'string' || !body.text.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Field "text" must be a non-empty string' }));
          return;
        }

        const context = body.context && typeof body.context === 'object' ? body.context : {};

        const clientController = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) {
            clientController.abort();
          }
        });

        try {
          const result = await interpret(body.text, context, { signal: clientController.signal });
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'x-model-used': result.modelUsed,
            'x-latency-ms': String(result.latencyMs)
          });
          res.end(JSON.stringify(result.draft));
        } catch (err) {
          if (err instanceof OllamaOfflineError) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          } else if (err instanceof TimeoutError) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          } else if (err instanceof ModelOutputError) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
          }
        }
      });
      return;
    }

    // -------------------------------------------------------------
    // Static Asset Serving & Security
    // -------------------------------------------------------------
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' }).end('Method Not Allowed');
      return;
    }

    // 1. Explicitly deny sensitive patterns with 403 Forbidden
    if (isDeniedPath(pathname)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
      return;
    }

    // 2. Only allow frontend assets from allowlist; return 404 for anything else
    if (!isAllowedStaticPath(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }

    // 3. Resolve target file
    const relPath = pathname === '/' ? '/index.html' : pathname;
    let file = path.resolve(root, '.' + relPath);

    // Prevent directory traversal outside root
    if (!file.startsWith(root + path.sep) && file !== path.resolve(root, 'index.html')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
      return;
    }

    if (isDeniedPath(pathname, file)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
      return;
    }

    try {
      let fileStat = await stat(file);
      if (fileStat.isDirectory()) {
        file = path.join(file, 'index.html');
        fileStat = await stat(file);
      }

      if (!fileStat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }

      const body = await readFile(file);
      const ext = path.extname(file).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(body);
      }
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  });
}

export const server = createServer();

// Start standalone server when executed directly
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`WeekBack: http://localhost:${PORT}`);
  });
}
