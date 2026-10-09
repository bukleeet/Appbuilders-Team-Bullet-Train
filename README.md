# WeekBack

Run `npm start`, then open http://localhost:3000. No dependencies or remote fonts required.

Initial UI: Today timeline/list, timed Week grid and details drawer, Tasks, Settings, manual task entry/editing, local saving, partial progress, recovery preview and undo. AI and automatic scheduling are pending; manual recovery proposals are labeled. No cloud sync.

Code boundaries: src/store.js (data), src/app.js (UI), src/styles.css (design).

Week → Manage study plan & recovery connects the pure scheduler through a temporary v1 adapter in src/planner-ui.js. Enter dated availability and fixed commitments, preview planning or repair, inspect changes/shortages, then accept or cancel. Accepted sessions appear in Week and persist locally; manage session locks and progress in the planner dialog. Undo restores the last accepted plan and is cleared after progress changes. Run `npm test` for scheduler checks.

Integration limitations: Today still uses legacy manual sessions, and legacy task dates still shift on later-day reloads. Person 3's stable timestamp model and persistence helpers must replace the adapter before full end-to-end completion. Local AI remains unavailable.

Existing saved tasks are preserved. To inspect the full sample design, choose Settings → Load sample week after exporting any data you want to keep. UI icons are bundled locally from Lucide; the license is in public/icons/LICENSE.
