/**
 * WeekBack — Local AI Browser Client
 * Connects the frontend to local Ollama endpoints (/api/ai/*).
 * Never writes to localStorage or manages persistence.
 */

export const AI_ERROR_CODES = Object.freeze({
  OFFLINE: 'OFFLINE',
  TIMEOUT: 'TIMEOUT',
  MALFORMED_OUTPUT: 'MALFORMED_OUTPUT',
  INVALID_REQUEST: 'INVALID_REQUEST'
});

export const AI_ERROR_MESSAGES = Object.freeze({
  OFFLINE: 'Ollama is not running locally on port 11434.',
  TIMEOUT: 'Model extraction timed out (exceeded limit).',
  MALFORMED_OUTPUT: 'Unable to parse valid task draft from model output.'
});

/**
 * Diagnostic client error representing local AI failures.
 */
export class AIClientError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'AIClientError';
    this.code = code;
  }
}

/**
 * Resolves the request URL, supporting custom baseUrl/endpoint overrides in tests.
 * Defaults to relative paths (e.g. '/api/ai/status') in the browser.
 */
function resolveUrl(defaultPath, options = {}) {
  if (options.url) return options.url;
  if (options.endpoint) return options.endpoint;
  if (options.baseUrl) {
    return `${options.baseUrl.replace(/\/$/, '')}${defaultPath}`;
  }
  return defaultPath;
}

/**
 * Checks the status of the local Ollama AI service.
 * Calls GET /api/ai/status.
 * Returns { ready: boolean, models: string[], error: string | null }.
 * Never throws on daemon failure.
 *
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.baseUrl]
 * @returns {Promise<{ ready: boolean, models: string[], error: string | null }>}
 */
export async function getAIStatus(options = {}) {
  const url = resolveUrl('/api/ai/status', options);
  const signal = options.signal;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        ready: Boolean(data?.available),
        models: Array.isArray(data?.models) ? data.models : [],
        error: null
      };
    }

    if (res.status === 503) {
      const data = await res.json().catch(() => ({}));
      return {
        ready: false,
        models: [],
        error: data?.error || AI_ERROR_MESSAGES.OFFLINE
      };
    }

    return {
      ready: false,
      models: [],
      error: AI_ERROR_MESSAGES.OFFLINE
    };
  } catch (err) {
    if (signal?.aborted || err.name === 'AbortError') {
      throw signal?.reason || err;
    }
    return {
      ready: false,
      models: [],
      error: AI_ERROR_MESSAGES.OFFLINE
    };
  }
}

/**
 * Interprets a natural language task description into a structured TaskDraft.
 * Calls POST /api/ai/interpret.
 * Returns Promise<TaskDraft> with { draft, meta: { modelUsed, latencyMs } }.
 *
 * @param {string} text - Task description entered by user.
 * @param {object} [context={}] - Context containing currentDate and timezone.
 * @param {object} [options={}]
 * @param {AbortSignal} [options.signal] - Signal for user-triggered cancellation.
 * @returns {Promise<object>} - TaskDraft object including { draft, meta }.
 */
export async function interpretTask(text, context = {}, { signal, ...options } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new AIClientError(
      AI_ERROR_CODES.INVALID_REQUEST,
      'Field "text" must be a non-empty string.'
    );
  }

  const url = resolveUrl('/api/ai/interpret', options);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ text: text.trim(), context }),
      signal
    });

    if (res.ok) {
      let draft;
      try {
        draft = await res.json();
      } catch (jsonErr) {
        throw new AIClientError(
          AI_ERROR_CODES.MALFORMED_OUTPUT,
          AI_ERROR_MESSAGES.MALFORMED_OUTPUT,
          { cause: jsonErr }
        );
      }

      const modelUsed = res.headers.get('x-model-used') || 'llama3.2:1b';
      const latencyHeader = res.headers.get('x-latency-ms');
      const latencyMs = latencyHeader != null ? Number(latencyHeader) : null;

      const meta = {
        modelUsed,
        latencyMs
      };

      return {
        ...draft,
        draft,
        meta
      };
    }

    if (res.status === 503) {
      throw new AIClientError(AI_ERROR_CODES.OFFLINE, AI_ERROR_MESSAGES.OFFLINE);
    }

    if (res.status === 504) {
      throw new AIClientError(AI_ERROR_CODES.TIMEOUT, AI_ERROR_MESSAGES.TIMEOUT);
    }

    if (res.status === 502) {
      throw new AIClientError(AI_ERROR_CODES.MALFORMED_OUTPUT, AI_ERROR_MESSAGES.MALFORMED_OUTPUT);
    }

    const errorPayload = await res.json().catch(() => ({}));
    throw new AIClientError(
      AI_ERROR_CODES.INVALID_REQUEST,
      errorPayload?.error || `Request failed with status ${res.status}`
    );
  } catch (err) {
    if (signal?.aborted || err.name === 'AbortError') {
      throw signal?.reason || err;
    }
    if (err instanceof AIClientError) {
      throw err;
    }
    // Network failure (server unreachable or offline)
    throw new AIClientError(AI_ERROR_CODES.OFFLINE, AI_ERROR_MESSAGES.OFFLINE, { cause: err });
  }
}
