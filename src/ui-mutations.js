import {recordProgress} from './store.js';

// Plan snapshots include tasks and progress; later edits make them unsafe to undo.
export function saveTaskEdit(state, task) {
  const index = state.tasks.findIndex(item => item.id === task.id);
  if (index < 0) state.tasks.push(task);
  else state.tasks[index] = task;
  for (const entry of state.history) entry.snapshot = null;
}

export function recordSessionProgress(state, progress) {
  const result = recordProgress(state, progress);
  for (const entry of state.history) entry.snapshot = null;
  return result;
}
