# WeekBack — UI specification

## Experience

The student should be able to answer three questions quickly: What should I do next? Can everything fit before its deadlines? What changes if I miss a session?

Primary flow: add task → confirm interpreted fields → plan week → mark actual progress → preview recovery → accept or undo.

## Visual direction

Use a quiet paper-like interface: warm off-white background (#F7F6F2), white cards, dark ink (#202A32), muted blue primary action (#285C79), and restrained course colors. Amber means attention and red means infeasible or invalid, never a judgment about the student. Use system sans-serif typography, tabular numbers for times, generous spacing, and visible keyboard focus. Avoid gamification, guilt messages, and an unexplained readiness score.

## App layout

Desktop, 1100 px and wider: left rail (Today, Week, Tasks, Settings), central calendar/day content, and an optional right task-details panel. Header shows the selected week, Today shortcut, Add task, and separate network/model status.

At 768–1099 px: collapse the rail to labeled icons; details open in a drawer. Below 768 px: show a day agenda and bottom navigation, with Week available as a horizontal day selector. Responsive UI does not imply that laptop model inference runs on a phone.

Calendar supports 30-minute visual rows but scheduling uses actual minutes. Provide a list alternative for keyboard and screen-reader users. Dragging is optional: every block has an Edit time action.

## Onboarding

Three short steps:

1. Confirm timezone and available study hours using weekday templates.
2. Add fixed classes/commitments; allow Skip and add later.
3. Add up to three tasks, using typed capture or manual fields.

Show a sample week only behind an explicit Try demo button. Never silently mix fixtures with real records. Explain the local-model download requirement before the first AI action. User can continue manually during setup.

## Today

Lead with the next planned block: task, course, time, and actionable step. Actions: Start, Done, Partially done, Missed. Start is a lightweight session state; a timer is optional and should not block work.

Below: today's agenda, approaching deadlines, and unscheduled work. Show “2 hours still need a slot before Friday” when capacity is insufficient. Recovery appears after an explicit progress or commitment change; avoid recurring unsolicited prompts.

## Week

Fixed commitments have subtle solid fills and a lock indicator. Study blocks use a course-colored edge and task label. Completed blocks have a check label; missed blocks have a text status. Do not encode status by color alone.

Top summary: planned study time, available time, and unallocated work. All numbers derive from schedule records. Selecting a block opens details and progress actions.

## Add task

Capture field example: “Math problem set due Friday 11:59 PM, about 2 hours.” Primary action: Interpret locally. Secondary: Enter manually.

While running, show “Interpreting on this laptop…” with Cancel. Result is an editable draft containing title, course, deadline, remaining effort, and optional suggested steps. Label unspecified fields “Needs your input”; never present guesses as facts. Deadline includes full date, time, and timezone.

Actions: Save task, Save and plan, Cancel. Saving without a deadline is permitted, but the task stays unscheduled until the user supplies planning constraints. Confirm any proposed task breakdown before creating steps.

## Recovery preview

Open a dedicated preview when the student reports a missed block or changes a constraint. Keep the existing plan visible and overlay proposed moves; also provide a textual change list.

Example: “Move 45 minutes of Math review from Tuesday to Wednesday. Keep Thursday's org meeting. Leave 30 minutes unscheduled because Friday has no free slots.”

Show: moved blocks, untouched commitments, deadline risks, and unallocated minutes. Actions: Accept changes, Edit constraints, Keep current plan. After acceptance, display Undo linked to the saved previous version. Never change the live calendar before acceptance.

If infeasible, say “The remaining work needs 90 more minutes than your available time.” Offer editable options such as add availability or reduce the user's own effort estimate. Never advise skipping class, sleep, or a deadline automatically.

## Tasks and details

Task list filters: All, Upcoming, Unscheduled, Completed; optional course filter. Each row shows title, deadline, remaining effort, and planned/unplanned state. Details expose estimates, dependencies, steps, source text from capture, and edit/delete actions. Deleting asks for confirmation only when scheduled blocks will also be removed.

## Status and failures

- Network disconnected: “Offline — saved on this laptop.” Core controls remain enabled.
- Model unavailable: “Local AI unavailable. Start the local model or enter details manually.”
- Model timeout/invalid result: preserve typed input; offer Retry and Manual entry. Do not create records.
- Storage failure: prominent “Changes could not be saved”; prevent success feedback and offer export of recoverable state.
- No tasks: show one clear Add your first task action.
- No availability: explain why planning cannot run and link directly to availability settings.
- Optional future sync: separate Pending sync/Last synced status from local save status. Disconnected data is not guaranteed current with the LMS.

## Accessibility and interaction

Use labeled fields, keyboard-operable dialogs, sensible focus return, Escape to close previews, and live announcements for save/error states. Meet WCAG AA contrast targets, respect reduced motion, and provide at least 44 px touch controls. Never rely on a colored calendar block or drag gesture alone.

## Settings

Availability, fixed commitments, session-length preferences, timezone, local-model connection/status, JSON export/import, and delete local data. Import previews counts and schema validity before applying; export is available without internet. Explain that browser-site data clearing can remove local records and encourage export without claiming encryption or backup that is not implemented.

## Five-minute demo

1. Show a realistic week with classes, three assignments, and an org meeting.
2. Disconnect networking and use typed input to add a changed commitment through local AI.
3. Mark one study block partially completed.
4. Preview recovery: highlight changed blocks, protected time, and an infeasible remainder if present.
5. Accept, reload to prove persistence, and undo to prove reversibility.

Show measured local timing and disclose the exact model. Do not simulate network loss with a cosmetic badge or present a prerecorded inference as live.

## MVP acceptance

A new student can enter availability and three tasks without technical knowledge beyond documented model setup. They can interpret a new task locally while disconnected, review extracted fields, generate a constraint-valid plan, record progress, inspect/accept recovery changes, undo, reload, and export. Every flow has a manual fallback and clear error state. Visual polish and 90+ judging potential require user evaluation; this specification alone does not prove either.
