import { z } from 'zod';

export const DEFAULT_MODEL = 'qwen3.5:0.8b';
export const DEFAULT_TIMEZONE = 'Asia/Manila';
export const DEFAULT_TIMEOUT_MS = 20_000;
export const OLLAMA_STATUS_TIMEOUT_MS = 2_000;
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

/**
 * Custom error thrown when the loopback Ollama daemon is unreachable,
 * offline, or rejected the connection.
 */
export class OllamaOfflineError extends Error {
  constructor(message = 'Ollama service is offline or unreachable', options) {
    super(message, options);
    this.name = 'OllamaOfflineError';
  }
}

/**
 * Custom error thrown when the task interpretation exceeds the timeout.
 */
export class TimeoutError extends Error {
  constructor(message = 'Task interpretation timed out', options) {
    super(message, options);
    this.name = 'TimeoutError';
  }
}

/**
 * Custom error thrown when the model produces invalid output, non-JSON output,
 * or output that fails contract validation.
 */
export class ModelOutputError extends Error {
  constructor(message = 'Invalid model output', options) {
    super(message, options);
    this.name = 'ModelOutputError';
  }
}

/**
 * Zod schema for a single task breakdown step.
 */
export const StepSchema = z.object({
  title: z.string().min(1),
  estimatedMinutes: z.number().int().nonnegative().nullable()
});

/**
 * Zod schema for the TaskDraft contract.
 */
export const TaskDraftSchema = z.object({
  title: z.string().min(1),
  course: z.string().nullable(),
  dueAt: z.string().datetime().nullable(),
  estimatedMinutes: z.number().int().nonnegative().nullable(),
  steps: z.array(StepSchema),
  missingFields: z.array(z.enum(['course', 'dueAt', 'estimatedMinutes'])),
  warnings: z.array(z.string())
});

/**
 * Helper to compute the UTC offset string (+HH:mm or -HH:mm) for an IANA timezone.
 */
function getTimezoneOffsetString(date, timeZone = DEFAULT_TIMEZONE) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset'
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (tzPart) {
      const match = tzPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
      if (match) {
        const sign = match[1];
        const hours = match[2].padStart(2, '0');
        const mins = (match[3] || '00').padStart(2, '0');
        return `${sign}${hours}:${mins}`;
      }
    }
  } catch {
    // Fall back to Asia/Manila standard UTC+8
  }
  return '+08:00';
}

/**
 * Builds a reference table of upcoming days for the next 7 days in the target timezone.
 * Helps the small local model resolve relative terms like "Friday", "tomorrow", or "next Monday".
 */
function getUpcomingDaysReference(baseDateIso, timezone) {
  const baseDate = new Date(baseDateIso);
  const days = [];
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(baseDate.getTime() + offset * 86_400_000);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: timezone });
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });
    const label = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : '';
    days.push(`- ${weekday}${label ? ` (${label})` : ''}: ${dateStr}`);
  }
  return days.join('\n');
}

/**
 * Detects explicit duration stated in input text (e.g. "2 hours", "90 mins", "1 hr 30 min", "half an hour").
 * Returns minutes as a number, or null if no explicit duration was mentioned.
 */
export function parseExplicitDuration(text) {
  if (typeof text !== 'string') return null;

  // 1. Strip course codes where prefix is ALL-CAPS in original text (e.g. "MATH 2h", "CS 101a", "BIO 3b")
  let t = text.replace(/\b[A-Z]{2,}\s*\d+[a-zA-Z]\b/g, ' ').toLowerCase();

  // 2. Strip deadline phrases: "due in 3 hours", "due within 2 hrs", "in 3 hours", "within 45 mins", "by 5 hours"
  t = t.replace(/\b(?:due\s+in|due\s+within|due\s+by|in|within)\s+\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/gi, ' ');

  // 3. Composite: "1 hour 30 mins", "1 hr 30 min", "2 hrs 15 mins", "1h 30m"
  const hrMinMatch = t.match(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:and\s*)?(\d+)\s*(?:mins?|minutes?|m)\b/i);
  if (hrMinMatch) {
    const hrs = parseFloat(hrMinMatch[1]);
    const mins = parseInt(hrMinMatch[2], 10);
    return Math.round(hrs * 60 + mins);
  }

  // 4. Word phrases: "half an hour", "quarter of an hour"
  if (/\b(?:half\s+an\s+hour|half\s+hour)\b/i.test(t)) {
    return 30;
  }
  if (/\b(?:quarter\s+of\s+an\s+hour|quarter\s+hour)\b/i.test(t)) {
    return 15;
  }

  // 5. Explicit hours: "2.5 hours", "2 hours", "2 hrs", "2 hr"
  const hrMatch = t.match(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i);
  if (hrMatch) {
    return Math.round(parseFloat(hrMatch[1]) * 60);
  }

  // 6. Bare hours: "2h", "1.5h" preceded by non-alphanumeric
  const bareHMatch = t.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*h\b/i);
  if (bareHMatch) {
    return Math.round(parseFloat(bareHMatch[1]) * 60);
  }

  // 7. Explicit minutes: "45 mins", "45 minutes", "45 min"
  const minMatch = t.match(/\b(\d+)\s*(?:mins?|minutes?)\b/i);
  if (minMatch) {
    return parseInt(minMatch[1], 10);
  }

  // 8. Bare minutes: "45m" preceded by non-alphanumeric
  const bareMMatch = t.match(/(?:^|[^a-z0-9])(\d+)\s*m\b/i);
  if (bareMMatch) {
    return parseInt(bareMMatch[1], 10);
  }

  return null;
}

/**
 * Normalizes a raw due date value into a canonical UTC ISO 8601 string ending in 'Z',
 * or null if invalid/absent.
 */
function normalizeDueAt(val, timezone = DEFAULT_TIMEZONE) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s || s.toLowerCase() === 'null') return null;

  // Already ISO with Z or explicit +/- offset
  if (/Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // YYYY-MM-DD or YYYY-MM-DD HH:mm(:ss)? or YYYY-MM-DDTHH:mm(:ss)?
  const match = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}(?::\d{2})?))?/);
  if (match) {
    const datePart = match[1];
    const timePart = match[2] ? (match[2].length === 5 ? `${match[2]}:00` : match[2]) : '23:59:00';
    const offset = getTimezoneOffsetString(new Date(), timezone);
    const d = new Date(`${datePart}T${timePart}${offset}`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  const fallback = new Date(s);
  return !Number.isNaN(fallback.getTime()) ? fallback.toISOString() : null;
}

/**
 * Checks if a thrown error represents an offline or unreachable network daemon.
 */
function isConnectionError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return false;
  const code = err.code || err.cause?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') {
    return true;
  }
  if (typeof err.message === 'string' && (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED'))) {
    return true;
  }
  return false;
}

/**
 * Constructs the system prompt for llama3.2:1b incorporating reference time,
 * base timezone, calendar lookup, and strict contract requirements.
 */
export function buildSystemPrompt(context = {}) {
  const timezone = context.timezone || DEFAULT_TIMEZONE;
  const currentDateIso = context.currentDate || new Date().toISOString();
  const upcomingTable = getUpcomingDaysReference(currentDateIso, timezone);
  const offset = getTimezoneOffsetString(new Date(currentDateIso), timezone);

  return `You are a local AI task parser for a student calendar.
Extract the user's task description into a structured JSON TaskDraft object.

Context:
- Current Reference Date & Time (ISO UTC): ${currentDateIso}
- Timezone: ${timezone} (Offset: ${offset})
- Upcoming Days Reference:
${upcomingTable}

Contract Schema:
{
  "title": string,
  "course": string or null,
  "dueAt": string or null, // ISO 8601 UTC string ending in 'Z', or null
  "estimatedMinutes": number or null, // Total duration in minutes, or null
  "steps": [
    { "title": string, "estimatedMinutes": number }
  ],
  "missingFields": ("course" | "dueAt" | "estimatedMinutes")[],
  "warnings": string[]
}

Rules:
1. Strict Nulls - NEVER invent defaults:
   - If no course code or subject is mentioned, set "course": null.
   - If no deadline or due date/time is mentioned, set "dueAt": null. NEVER guess or assume a deadline.
   - If no duration is explicitly stated in the input text, set "estimatedMinutes": null. NEVER guess duration.
   - If "course" is null, "course" must be included in "missingFields".
   - If "dueAt" is null, "dueAt" must be included in "missingFields".
   - If "estimatedMinutes" is null, "estimatedMinutes" must be included in "missingFields".

2. Dates & Timezone:
   - Convert any relative deadline ("tomorrow", "tonight", "Friday 11:59 PM") into a UTC ISO 8601 string ending in 'Z'.
   - Local time in ${timezone} is ${offset} from UTC.
   - If no specific hour is given for a date, assume 23:59:00 local time.
   - Example: If Manila time is Friday 23:59:00 (+08:00), UTC is Friday 15:59:00.000Z.

3. Steps Decomposition:
   - Decompose vague or multi-step tasks into 2 to 4 concrete, actionable steps.
   - Every step must have a descriptive "title" and an integer "estimatedMinutes".

Output ONLY valid JSON matching the schema.`;
}

/**
 * Pings http://127.0.0.1:11434/api/tags with a 2000ms timeout using AbortSignal.
 * Returns { available: boolean, models: string[] }.
 * Does not throw on connection failure.
 *
 * @param {object} [options]
 * @param {number} [options.timeoutMs=2000]
 * @param {string} [options.url]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ available: boolean, models: string[] }>}
 */
export async function checkOllamaStatus(options = {}) {
  const timeoutMs = options.timeoutMs ?? OLLAMA_STATUS_TIMEOUT_MS;
  const baseUrl = options.baseUrl || OLLAMA_BASE_URL;
  const url = options.url || `${baseUrl}/api/tags`;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      return { available: false, models: [] };
    }
    const data = await res.json();
    const models = Array.isArray(data?.models)
      ? data.models.map((m) => (typeof m === 'string' ? m : m.name || m.model)).filter(Boolean)
      : [];
    return { available: true, models };
  } catch {
    return { available: false, models: [] };
  }
}

/**
 * Interprets natural language task input via loopback Ollama llama3.2:1b into a structured TaskDraft.
 * Never persists data to disk or database.
 *
 * @param {string} text - Natural language task description.
 * @param {object} [context={}]
 * @param {string} [context.currentDate] - ISO UTC timestamp string.
 * @param {string} [context.timezone='Asia/Manila'] - Base timezone name.
 * @param {object} [options={}]
 * @param {AbortSignal} [options.signal] - Upstream abort signal.
 * @param {number} [options.timeoutMs=10000] - Timeout in milliseconds.
 * @param {string} [options.url] - Ollama generate endpoint URL override.
 * @param {string} [options.model='llama3.2:1b'] - Model identifier.
 * @returns {Promise<{ draft: object, modelUsed: string, latencyMs: number }>}
 */
export async function interpretTask(text, context = {}, { signal, timeoutMs, url, baseUrl, model } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new ModelOutputError('Task description cannot be empty');
  }

  const effectiveTimeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const effectiveBaseUrl = baseUrl || OLLAMA_BASE_URL;
  const effectiveUrl = url || `${effectiveBaseUrl}/api/generate`;
  const effectiveModel = model || DEFAULT_MODEL;

  let timeoutTimer;
  let internalTimeoutTriggered = false;
  const internalController = new AbortController();

  timeoutTimer = setTimeout(() => {
    internalTimeoutTriggered = true;
    internalController.abort();
  }, effectiveTimeoutMs);

  const fetchSignal = signal
    ? AbortSignal.any([signal, internalController.signal])
    : internalController.signal;

  const startMs = performance.now();

  try {
    const systemPrompt = buildSystemPrompt(context);
    const body = {
      model: effectiveModel,
      prompt: `Task to interpret:\n"${text.trim()}"\n\nTaskDraft JSON:`,
      system: systemPrompt,
      format: 'json',
      stream: false,
      think: false,
      options: {
        temperature: 0.1
      }
    };

    let res;
    try {
      res = await fetch(effectiveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: fetchSignal
      });
    } catch (fetchErr) {
      if (internalTimeoutTriggered) {
        throw new TimeoutError(`Task interpretation timed out after ${effectiveTimeoutMs}ms`, { cause: fetchErr });
      }
      if (signal?.aborted) {
        if (signal.reason?.name === 'TimeoutError' || signal.reason instanceof TimeoutError) {
          throw new TimeoutError('Task interpretation timed out', { cause: signal.reason });
        }
        throw signal.reason || fetchErr;
      }
      if (isConnectionError(fetchErr)) {
        throw new OllamaOfflineError(`Ollama is unreachable at ${effectiveUrl}: ${fetchErr.message}`, { cause: fetchErr });
      }
      throw fetchErr;
    }

    if (!res.ok) {
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new OllamaOfflineError(`Ollama server returned status ${res.status}`);
      }
      const errText = await res.text().catch(() => '');
      throw new ModelOutputError(`Ollama request failed with status ${res.status}: ${errText}`);
    }

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      throw new ModelOutputError(`Failed to parse Ollama response as JSON: ${parseErr.message}`, { cause: parseErr });
    }

    if (!data || typeof data.response !== 'string') {
      throw new ModelOutputError('Ollama response did not contain a valid "response" string');
    }

    let rawDraft;
    try {
      let cleaned = data.response.trim();
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      rawDraft = JSON.parse(cleaned);
    } catch (jsonErr) {
      throw new ModelOutputError(
        `Model output could not be parsed as JSON: ${jsonErr.message}. Output was: ${data.response}`,
        { cause: jsonErr }
      );
    }

    if (!rawDraft || typeof rawDraft !== 'object' || Array.isArray(rawDraft)) {
      throw new ModelOutputError('Model output must be a JSON object');
    }

    // Normalization & Strict Null Rules
    const timezone = context.timezone || DEFAULT_TIMEZONE;
    const explicitDuration = parseExplicitDuration(text);

    const title = typeof rawDraft.title === 'string'
      ? rawDraft.title.trim()
      : rawDraft.title;

    const course = typeof rawDraft.course === 'string' && rawDraft.course.trim()
      ? rawDraft.course.trim()
      : null;

    const dueAt = normalizeDueAt(rawDraft.dueAt, timezone);

    let estimatedMinutes = null;
    const warnings = Array.isArray(rawDraft.warnings)
      ? rawDraft.warnings.filter((w) => typeof w === 'string')
      : [];

    if (explicitDuration !== null) {
      estimatedMinutes = explicitDuration;
    } else if (typeof rawDraft.estimatedMinutes === 'number' && rawDraft.estimatedMinutes > 0) {
      // Model suggested a duration but none was stated in text:
      // Enforce strict null for contract missingFields, but record model estimate in warnings
      estimatedMinutes = null;
      warnings.push(`Model estimated ${Math.round(rawDraft.estimatedMinutes)} minutes (unconfirmed)`);
    }

    // Steps normalization: return steps as-is from model mapped to StepSchema
    // If steps is omitted, null, or empty, default to [] without inventing steps
    let steps = [];
    if (Array.isArray(rawDraft.steps)) {
      steps = rawDraft.steps
        .filter((s) => s && typeof s === 'object')
        .map((s, idx) => ({
          title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : `Step ${idx + 1}`,
          estimatedMinutes: typeof s.estimatedMinutes === 'number' && Number.isFinite(s.estimatedMinutes) && s.estimatedMinutes >= 0
            ? Math.round(s.estimatedMinutes)
            : null
        }));
    }

    // Synchronize missingFields strictly with actual field presence
    const missingFields = [];
    if (course === null) missingFields.push('course');
    if (dueAt === null) missingFields.push('dueAt');
    if (estimatedMinutes === null) missingFields.push('estimatedMinutes');

    const draft = {
      title,
      course,
      dueAt,
      estimatedMinutes,
      steps,
      missingFields,
      warnings
    };

    // Strict contract validation
    const parsedDraft = TaskDraftSchema.safeParse(draft);
    if (!parsedDraft.success) {
      throw new ModelOutputError(`Draft failed schema validation: ${parsedDraft.error.message}`, {
        cause: parsedDraft.error
      });
    }

    const latencyMs = Math.round(performance.now() - startMs);

    return {
      draft: parsedDraft.data,
      modelUsed: effectiveModel,
      latencyMs
    };
  } catch (err) {
    if (err instanceof OllamaOfflineError || err instanceof TimeoutError || err instanceof ModelOutputError) {
      throw err;
    }
    if (signal?.aborted) {
      throw signal.reason || err;
    }
    throw new ModelOutputError(err.message, { cause: err });
  } finally {
    clearTimeout(timeoutTimer);
  }
}
