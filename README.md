# Waypoint

A local-first weekly study planner for students. Tasks, deadlines and study sessions stay in the browser. A deterministic scheduler fits work into the study time you enter. An optional local AI model (via Ollama) turns a typed sentence into a task draft. There are no accounts and no cloud sync.

> The project started as **WeekBack**. Code, the npm package name and the browser storage keys (`weekback-*`) still use that name.

## Quick start

Requires Node.js 20.3 or newer (developed on Node 25).

```sh
npm install
npm start          # http://localhost:3000  (set PORT to change)
```

The planner works fully without AI. To try it with sample data, open **Settings → Load sample week**.

### Optional: local AI

1. Install a recent [Ollama](https://ollama.com). Older builds cannot load Qwen 3.5.
2. `ollama pull qwen3.5:2b`
3. Keep Ollama running on `127.0.0.1:11434`, then `npm start`.

The server talks to Ollama only over loopback. Without Ollama, the AI endpoints report "unavailable" and manual entry keeps working. Add Task and Ask Waypoint probe readiness and interpret descriptions into editable drafts. Missing fields stay blank; model-guessed effort is offered separately. Cancel stops the request, and manual entry remains available.

## Using it

- **Tasks** hold the work: title, course, remaining minutes, optional deadline and next step.
- **Week → Manage study plan & recovery:**
  - Enter dated study availability and fixed commitments in Philippine time.
  - *Preview plan*, review the proposed sessions and anything that could not fit, then accept or cancel.
- **Progress:** mark a session *Done*, *Partial* (minutes completed) or *Missed* from Today, the Week drawer or the planner. Remaining work updates once per session; repeated clicks don't subtract twice.
- **Recovery:** *Missed* or *Preview recovery* proposes how to reschedule the remaining work. Nothing changes until you accept. *Undo* restores the previous plan. It is cleared once a task is added/edited or new progress is recorded, so undo never erases progress.
- **Locks:** a locked session is never moved by planning or recovery.
- **Backups:** Settings → *Export JSON backup* / *Import backup*. Imports are validated, and a bad file leaves your data untouched.

### Scheduling rules

The scheduler (`src/scheduler.js`) is a pure function with no I/O:

- It uses only the availability you entered. It never invents time.
- Earliest deadline first; tasks without a deadline go last.
- Sessions fall on a 15-minute grid, last 30–120 minutes, and have a 15-minute gap between them.
- It never overlaps fixed commitments, never moves locked or finished sessions, and never ends a session after its deadline.
- Work that doesn't fit is reported with the exact minutes and a reason (e.g. *Not enough study time before the deadline*).

## Data

- Stored in `localStorage` under `weekback-v2` (schema version 2). All times are UTC instants, displayed in Asia/Manila, so dates don't shift when the app is reopened on a later day.
- Data from the earlier v1 UI is migrated automatically on first load. The original is kept under `weekback-v1-backup`.
- Unreadable or invalid saved data is preserved under `weekback-corrupt-<timestamp>` instead of being overwritten.
- Save failures (e.g. storage full) are shown in the UI with a prompt to export a backup.

## Architecture

| Area | Files |
|---|---|
| Data model, dates, persistence, sample data | `src/model.js`, `src/dates.js`, `src/store.js`, `src/fixtures.js` |
| Scheduler | `src/scheduler.js` |
| UI | `src/app.js`, `src/planner-ui.js`, `src/assistant-ui.js`, `src/task-capture.js`, `src/task-draft-ui.js`, `src/ui-mutations.js`, `src/styles.css`, `index.html` |
| Local server and AI | `server.js`, `server/ai.js`, browser client `src/ai-client.js` |

`server.js` serves only app assets: `/`, `/index.html`, `/src/**`, `/public/**`. Everything else, including server code, `package.json`, tests, `node_modules` and `.git`, is refused. It also exposes:

| Endpoint | Purpose | Responses |
|---|---|---|
| `GET /api/ai/status` | Probe Ollama | `200 {available, models}`, `503` when not running |
| `POST /api/ai/interpret` `{text, context}` | Typed task → `TaskDraft` | `200` draft (+ `x-model-used`, `x-latency-ms`), `400` bad request, `413` too large, `502` unreadable model output, `503` Ollama offline, `504` timeout (45 s) |

A `TaskDraft` never writes calendar data. Missing course, deadline or duration stay `null` and are listed in `missingFields`. Durations come from the text only (e.g. "2h", "45 mins"). A model-guessed duration is returned as a warning, not a value.

## Testing

```sh
npm test           # node --test tests/*.test.js
npm run check      # syntax check of all modules
```

The test suite covers:

- the scheduler: deadlines, locks, gaps, capacity shortfalls, partial progress, invalid dates, repair, determinism and immutability
- the data layer: round-trip, migration, corrupt data, quota errors, undo
- the UI's data helpers
- the AI endpoints with a mocked Ollama: malformed output, absent model, timeout, cancellation

## Measured results

- **Automated tests:** run `npm test` for current results.
- **Browser walkthrough** (headless Chrome, zero page errors):
  - sample week, add task, plan, accept
  - Missed → recovery → accept → undo
  - partial progress, reload (data unchanged)
  - export/import, v1 migration
  - 390 px mobile width with no horizontal scroll
- **Local AI latency, measured on CPU** with `think: false`:

  | Model | First request (cold) | Later requests (warm) | Relative dates ("tomorrow 3pm", "Friday 11:59pm", "next Monday") |
  |---|---|---|---|
  | `qwen3.5:2b` (default) | ~25–35 s | ~11–16 s | All correct |
  | `qwen3.5:0.8b` | — | ~8–10 s | Wrong in 3 of 3 cases |

  A separate local walkthrough measured a 2B interpretation at 23.2 seconds and one request timed out after 45 seconds. These measurements use different environments and are not a controlled comparison.

## Limitations

- **Ask Waypoint supports task capture, not conversational schedule changes.** Draft deadlines must be reviewed. Explicit named Manila calendar deadlines are normalized deterministically; other language relies on model interpretation.
- **AI responses are slow on CPU** (see above).
- **The sample week is anchored to Monday.** Late in the week most sample deadlines have already passed, so recovery reports them as unschedulable.
- **v1 migration is basic.** v1 fixed commitments, saved availability, commitments, accepted study blocks and task deadlines are carried into v2. Malformed individual legacy planner entries are skipped; the untouched v1 backup remains available.
- **Single device only.** Data lives in one browser; use export/import to move it.

UI icons are bundled locally from [Lucide](https://lucide.dev); the license is in `public/icons/LICENSE`.
