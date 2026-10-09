# Offline student planner — implementation plan

## Product decision

Build a student planner that remains fully usable on unreliable campus Wi-Fi. A student captures assignments in ordinary language, sees a feasible week, and repairs it after missed work or changed commitments. Working name: WeekBack.

Example: “I missed yesterday's two-hour review. I have a quiz Friday and an org meeting tonight.” The app interprets the change locally, asks about ambiguous facts, and previews a revised plan that preserves classes, sleep, and locked commitments.

Offline availability is justified by the user's reported campus connectivity. It does not establish novelty or guarantee a 90+ judging score. Adaptive planners already exist; usefulness, execution, and measured differentiation must support the submission.

## Scope and existing workspace

The current workspace contains an unrelated Dinig audio prototype in index.html, app.js, and styles.css. Preserve it during planning. Implement the planner in a separate planner/ directory when implementation is authorized. Do not reuse its microphone flow.

MVP includes manual schedule setup, text task capture, local AI interpretation and task decomposition, weekly planning, missed-session repair, review before changes, local persistence, undo, and JSON export/import. No audio.

Defer LMS integrations, accounts, multi-device cloud sync, collaboration, grade prediction, automatic submissions, notifications requiring a background service, screenshot OCR, and syllabus ingestion. These expand risk and are unnecessary to prove the core loop.

## Architecture

Use React + TypeScript + Vite for the UI, Dexie/IndexedDB for local data, and a small local Node service for model calls. Use Ollama with a downloaded small instruction model as the initial runtime; select the exact model only after measuring extraction quality and latency on the ASUS TUF A15 with 32 GB RAM. Do not assume its GPU or VRAM. Bind the service to loopback and restrict browser origins to the app.

Package a localhost-served build for the hackathon. Internet is required for initial dependency/model downloads; subsequent core use must work disconnected. This is a laptop MVP, not a promise of phone support. Document the required running local services. A PWA shell can be added later; a cached page alone is not proof of local inference.

Local model responsibilities:

- Convert ordinary-language tasks and schedule changes into structured draft fields.
- Suggest small actionable work steps for vague assignments.
- Identify missing information and ask concise clarification questions.

Deterministic scheduling responsibilities:

- Validate dates, task durations, dependencies, and time capacity.
- Allocate study blocks inside user-approved availability.
- Preserve hard constraints and locked blocks.
- Repair the plan using an explicit objective: satisfy deadlines, then minimize changes to existing blocks, then respect soft preferences.
- Detect infeasibility and produce a factual explanation from the violated constraints.

The model never directly writes calendar records. Validate its structured output, show it for confirmation, and pass confirmed data to the scheduler. Generate change explanations from actual schedule differences rather than inventing reasons with the model. If the model is unavailable, manual capture and deterministic planning remain usable; show that AI features are unavailable.

## Data model

- Course: id, name, optional code, color.
- Commitment: id, title, start/end, recurrence, locked flag, category.
- Availability: weekday, start/end; sleep and breaks represented as unavailable time.
- Task: id, title, courseId, dueAt, remainingMinutes, priority, dependencies, status, provenance (user or confirmed AI draft).
- WorkStep: id, taskId, title, estimatedMinutes, completion state.
- StudyBlock: id, taskId/stepId, start/end, locked flag, planned/completed/missed state.
- PlanVersion: id, parentId, createdAt, trigger, snapshot, diff, accepted state.
- Preferences: timezone, minimum/maximum session length, break length, latest finish time.

Store timestamps consistently and render in Asia/Manila by default. “Tomorrow” is resolved against the visible current date and timezone. Missing deadlines or durations require confirmation. Keep estimates visibly editable. Export schemaVersion and reject unsupported imports without overwriting data.

## Implementation sequence

### 1. Feasibility gate: first 60–90 minutes

Prepare 20 task/change statements with ground-truth dates and constraints, including ambiguity, Taglish, conflicting commitments, and missing durations. Run local structured extraction on the demo laptop. Record field accuracy, invalid outputs, ambiguity handling, latency, and memory. A practical initial gate is at least 90% accuracy on explicit fields, no silent invented deadlines, and median response within 10 seconds. These are proposed gates, not measured results.

If local extraction is too slow, shorten input and evaluate a smaller model. Do not replace local inference with a hidden cloud API. If quality remains inadequate, pause expansion and reassess the product before building more UI.

### 2. Local foundation: 60–90 minutes

Create the planner app, domain types, local database, fixtures, and import/export. Build onboarding, task entry, and a read-only week view. Verify persistence after reload and disconnected restart.

### 3. Reliable planning: 90–120 minutes

Implement slot generation and scheduling with hard constraints. Begin with greedy earliest-deadline allocation plus bounded repair search; use a solver only if representative cases demonstrate a need. Explicitly report unallocated work instead of violating locked time or pretending an impossible plan is feasible.

### 4. Local AI flow: 60–90 minutes

Connect typed capture and task decomposition to the local model. Add schema validation, timeouts, progress feedback, cancellation, and editable confirmation cards. Treat pasted text as data, never instructions for tools or filesystem access.

### 5. Recovery loop: 90 minutes

Mark blocks missed, update remaining work, accept changed deadlines, generate a plan diff, and implement accept/undo. Provide a partial-completion option; missing a two-hour session must not automatically add two hours if the user already did some work.

### 6. Verification and demo: 60–90 minutes

Run constraint tests and held-out extraction cases. Test the full flow with networking disabled. Record actual local model and hardware details, timings, and known failures. Prepare a one-minute video and five-minute live scenario. Reserve contingency time before the event deadline; estimates above are planning ranges, not guarantees.

## Required verification

- No overlapping blocks, scheduling outside availability, moved locked commitments, or silently missed hard deadlines.
- Infeasible capacity is reported with the shortage in minutes and affected tasks.
- Repair preserves unaffected blocks when feasible; compare changed-block count with a full rebuild baseline.
- Accept is atomic; undo restores the previous version exactly.
- Missed/partial work updates remaining minutes consistently.
- Model extraction is tested on a held-out set distinct from prompt examples.
- Disconnect network after setup, restart, capture a new task with local AI, repair, accept, reload, and export.
- Compare task-entry/replanning time with manual calendar use; record participant results honestly. A generic chatbot comparison must use the same facts and constraints.

## Six tests and judging evidence

Excel remains a risk: scheduling alone is algorithmic. Prove that natural-language capture and useful task decomposition materially reduce effort; if they add little value, do not claim meaningful AI.

ChatGPT remains a risk: persistent editable calendar state, validated constraints, immediate acceptance/undo, and disconnected inference improve the workflow, but must be demonstrated rather than asserted.

Adoption: one student can begin with three tasks and a weekly availability template; no institutional access. Trust: all AI fields and schedule changes are reviewable. Data: user-supplied tasks and schedules suffice. Local: new AI-assisted changes continue during actual connectivity loss.

Use the event weights as a planning framework: usefulness 25, Local AI 25, technical execution 20, innovation 15, product/demo 15. The 90+ objective is aspirational until evidence exists. Show a real student scenario, meaningful disconnected inference, reliable constraints, honest competitor comparison, and a polished recovery demo. Do not turn target points into claimed results.

## Optional synchronization after MVP

Keep backup/multi-device synchronization separate from core use. Add an operation log with unique IDs and explicit conflict review. Never silently overwrite deadline changes made on different devices. While offline, show the last sync time; never imply that the planner knows new LMS announcements. For the hackathon, local export/import is sufficient and must not be presented as cloud synchronization.
