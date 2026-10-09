# Waypoint

Run `npm install`, then `npm start` and open http://localhost:3000. Icons and fonts are local. For optional local task extraction, start Ollama and install `qwen3.5:2b`.

Today and Week render stable v2 study blocks and commitments. Tasks are saved through the validated v2 store, with migration backups for old data. Settings supports validated backup import/export and explicit sample loading. No cloud sync.

Code boundaries: src/store.js (data), src/app.js (UI), src/styles.css (design).

Week → Manage study plan & recovery uses `planWeek`/`repairPlan` with the shared state. Enter availability and commitments, inspect changes and shortages, then accept/cancel. Acceptance, undo and progress use Person 3's helpers. Today and Week share the same sessions. Run `npm test` for module checks.

Add Task → Describe a task calls the local extraction API. Review title, course, deadline, effort and steps before saving; uncertain estimates require explicit confirmation. Cancellation and manual entry are available. Ask Waypoint reuses task capture for the demo; conversational schedule Q&A is not implemented. AI status is probed on load and in Settings.

Existing saved tasks are preserved. To inspect the full sample design, choose Settings → Load sample week after exporting any data you want to keep. UI icons are bundled locally from Lucide; the license is in public/icons/LICENSE.
