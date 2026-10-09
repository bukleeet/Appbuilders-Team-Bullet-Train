/**
 * WeekBack — Demo Fixtures
 * Rule: Demo fixtures load ONLY through an explicit action.
 * Never silently seeded into empty storage.
 */

import { parseInTimezone, toLocalDateAndTime, addMinutes } from './dates.js';
import {
  createAppState,
  createTask,
  createCommitment,
  createWindow,
  createStudyBlock,
  TASK_STATUS,
  BLOCK_STATUS,
  DEFAULT_TIMEZONE
} from './model.js';

/**
 * Creates an explicit demonstration AppState.
 * Anchor date defaults to the current week's Monday in Asia/Manila.
 * @param {Date|string} [anchorInput=new Date()]
 * @param {string} [timezone=DEFAULT_TIMEZONE]
 * @returns {import('./model.js').AppState}
 */
export function createDemoFixtures(anchorInput = new Date(), timezone = DEFAULT_TIMEZONE) {
  const anchorDate = anchorInput instanceof Date ? anchorInput : new Date(anchorInput);
  const { date: todayStr } = toLocalDateAndTime(anchorDate, timezone);

  // Compute Monday of the anchor week
  const todayObj = new Date(`${todayStr}T12:00:00+08:00`);
  const dayOfWeek = todayObj.getUTCDay(); // 0 is Sunday, 1 is Monday ...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const mondayMs = todayObj.getTime() + diffToMonday * 24 * 60 * 60 * 1000;
  const mondayDate = new Date(mondayMs);
  const { date: monStr } = toLocalDateAndTime(mondayDate, timezone);

  // Helper to get date string for Day offset from Monday (0 = Mon, 1 = Tue, 2 = Wed, 3 = Thu, 4 = Fri, 5 = Sat, 6 = Sun)
  function getDayDateStr(offsetDays) {
    const dMs = new Date(`${monStr}T12:00:00+08:00`).getTime() + offsetDays * 24 * 60 * 60 * 1000;
    return toLocalDateAndTime(new Date(dMs), timezone).date;
  }

  const dMon = getDayDateStr(0);
  const dTue = getDayDateStr(1);
  const dWed = getDayDateStr(2);
  const dThu = getDayDateStr(3);
  const dFri = getDayDateStr(4);
  const dSat = getDayDateStr(5);
  const dSun = getDayDateStr(6);

  // 1. Availability Windows (Weekday 09:00 - 21:00; Weekend 10:00 - 18:00)
  const availability = [
    createWindow({ id: 'win_mon', startAt: parseInTimezone(dMon, '09:00', timezone), endAt: parseInTimezone(dMon, '21:00', timezone) }),
    createWindow({ id: 'win_tue', startAt: parseInTimezone(dTue, '09:00', timezone), endAt: parseInTimezone(dTue, '21:00', timezone) }),
    createWindow({ id: 'win_wed', startAt: parseInTimezone(dWed, '09:00', timezone), endAt: parseInTimezone(dWed, '21:00', timezone) }),
    createWindow({ id: 'win_thu', startAt: parseInTimezone(dThu, '09:00', timezone), endAt: parseInTimezone(dThu, '21:00', timezone) }),
    createWindow({ id: 'win_fri', startAt: parseInTimezone(dFri, '09:00', timezone), endAt: parseInTimezone(dFri, '21:00', timezone) }),
    createWindow({ id: 'win_sat', startAt: parseInTimezone(dSat, '10:00', timezone), endAt: parseInTimezone(dSat, '18:00', timezone) }),
    createWindow({ id: 'win_sun', startAt: parseInTimezone(dSun, '10:00', timezone), endAt: parseInTimezone(dSun, '18:00', timezone) })
  ];

  // 2. Fixed Commitments (Classes, Lab, Org meeting)
  const commitments = [
    createCommitment({
      id: 'cmt_math_mon',
      title: 'MATH 54 Lecture',
      startAt: parseInTimezone(dMon, '10:00', timezone),
      endAt: parseInTimezone(dMon, '11:30', timezone)
    }),
    createCommitment({
      id: 'cmt_cs_mon',
      title: 'CS 150 Lab',
      startAt: parseInTimezone(dMon, '13:00', timezone),
      endAt: parseInTimezone(dMon, '15:00', timezone)
    }),
    createCommitment({
      id: 'cmt_math_wed',
      title: 'MATH 54 Lecture',
      startAt: parseInTimezone(dWed, '10:00', timezone),
      endAt: parseInTimezone(dWed, '11:30', timezone)
    }),
    createCommitment({
      id: 'cmt_org_thu',
      title: 'Org General Assembly',
      startAt: parseInTimezone(dThu, '17:00', timezone),
      endAt: parseInTimezone(dThu, '18:30', timezone)
    }),
    createCommitment({
      id: 'cmt_cs_fri',
      title: 'CS 150 Lab',
      startAt: parseInTimezone(dFri, '13:00', timezone),
      endAt: parseInTimezone(dFri, '15:00', timezone)
    })
  ];

  // 3. Tasks matching reference problem set
  const taskMath = createTask({
    id: 'demo_task_math',
    title: 'Problem Set 4: Eigenvalues & Symmetric Matrices',
    course: 'MATH 54',
    dueAt: parseInTimezone(dFri, '23:59', timezone),
    remainingMinutes: 150,
    status: TASK_STATUS.OPEN,
    steps: [
      { id: 'step_math_1', title: 'Review lecture notes on eigenspaces', completed: false, estimatedMinutes: 30 },
      { id: 'step_math_2', title: 'Solve problems 1 through 5', completed: false, estimatedMinutes: 60 },
      { id: 'step_math_3', title: 'Write up proofs for problems 6-8', completed: false, estimatedMinutes: 60 }
    ],
    sourceText: 'MATH 54 problem set 4 due Friday 11:59 PM, around 2.5 hours'
  });

  const taskCS = createTask({
    id: 'demo_task_code',
    title: 'Machine Problem 2: Gaussian Elimination',
    course: 'CS 150',
    dueAt: parseInTimezone(dThu, '23:59', timezone),
    remainingMinutes: 120,
    status: TASK_STATUS.OPEN,
    steps: [
      { id: 'step_cs_1', title: 'Implement pivot selection', completed: false, estimatedMinutes: 40 },
      { id: 'step_cs_2', title: 'Forward elimination algorithm', completed: false, estimatedMinutes: 40 },
      { id: 'step_cs_3', title: 'Back substitution & test suite', completed: false, estimatedMinutes: 40 }
    ],
    sourceText: 'CS 150 MP2 due Thursday midnight, 2 hours'
  });

  const taskHist = createTask({
    id: 'demo_task_hist',
    title: 'Source Analysis Paper',
    course: 'KAS 1',
    dueAt: parseInTimezone(dSun, '23:59', timezone),
    remainingMinutes: 90,
    status: TASK_STATUS.OPEN,
    steps: [
      { id: 'step_kas_1', title: 'Read primary documents', completed: false, estimatedMinutes: 30 },
      { id: 'step_kas_2', title: 'Draft comparative analysis', completed: false, estimatedMinutes: 60 }
    ],
    sourceText: 'KAS 1 paper due Sunday 11:59 PM'
  });

  const tasks = [taskMath, taskCS, taskHist];

  // 4. Study Blocks scheduled inside availability and avoiding commitments
  const blocks = [
    createStudyBlock({
      id: 'demo_blk_math',
      taskId: taskMath.id,
      startAt: parseInTimezone(dTue, '14:00', timezone),
      endAt: parseInTimezone(dTue, '16:30', timezone),
      locked: false,
      status: BLOCK_STATUS.PLANNED,
      completedMinutes: 0
    }),
    createStudyBlock({
      id: 'demo_blk_cs',
      taskId: taskCS.id,
      startAt: parseInTimezone(dWed, '15:30', timezone),
      endAt: parseInTimezone(dWed, '17:30', timezone),
      locked: false,
      status: BLOCK_STATUS.PLANNED,
      completedMinutes: 0
    }),
    createStudyBlock({
      id: 'demo_blk_hist',
      taskId: taskHist.id,
      startAt: parseInTimezone(dSat, '14:00', timezone),
      endAt: parseInTimezone(dSat, '15:30', timezone),
      locked: false,
      status: BLOCK_STATUS.PLANNED,
      completedMinutes: 0
    })
  ];

  return createAppState({
    timezone,
    tasks,
    commitments,
    availability,
    blocks,
    history: []
  });
}
