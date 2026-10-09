# WeekBack

Run `npm install`, then `npm start`, and open http://localhost:3000. No remote fonts required.

UI: Today timeline/list, timed Week grid and details drawer, Tasks, Settings, manual task entry/editing, local saving, session progress (done, partial, missed), scheduler-based recovery preview, accept and undo, and backup export/import. No cloud sync.

Code boundaries: src/model.js, src/dates.js, src/store.js, src/fixtures.js (data, schema v2), src/scheduler.js (planning), src/app.js and src/planner-ui.js (UI), src/styles.css (design), server.js and server/ai.js (local server and AI).

Tasks hold the remaining work and deadline; study sessions come from the scheduler. Week → Manage study plan & recovery: enter dated availability and fixed commitments, preview planning or repair, inspect changes and shortages, then accept or cancel. Marking a session missed opens a recovery preview built from your availability. Undo restores the last accepted plan and is cleared after progress is recorded. Run `npm test` for all module checks.

Integration limitations: Local AI is not yet connected to the UI (quick capture and the assistant page are placeholders). Data saved by the old v1 UI is migrated automatically on first load, with the original kept under the `weekback-v1-backup` key.

Existing saved tasks are preserved. To inspect the full sample design, choose Settings → Load sample week after exporting any data you want to keep. UI icons are bundled locally from Lucide; the license is in public/icons/LICENSE.
