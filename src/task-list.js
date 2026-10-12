// Keep unfinished, time-sensitive work easy to find without changing stored order.
export function sortedTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const completed = Number(a.status === 'done') - Number(b.status === 'done');
    if (completed) return completed;
    const dueA = a.dueAt ? Date.parse(a.dueAt) : Infinity;
    const dueB = b.dueAt ? Date.parse(b.dueAt) : Infinity;
    if (dueA !== dueB) return dueA - dueB;
    return a.title.localeCompare(b.title);
  });
}

export function isOverdue(task, now = Date.now()) {
  return task.status !== 'done' && Boolean(task.dueAt) && Number.isFinite(Date.parse(task.dueAt)) && Date.parse(task.dueAt) < now;
}

export function overdueTasks(tasks, now = Date.now()) {
  return sortedTasks(tasks.filter(task => isOverdue(task, now)));
}

export function matchesTask(task, query = '', filter = 'all', now = Date.now()) {
  if (filter === 'open' && task.status === 'done') return false;
  if (filter === 'done' && task.status !== 'done') return false;
  if (filter === 'overdue' && !isOverdue(task, now)) return false;
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const searchable = `${task.title} ${task.course || ''}`.toLocaleLowerCase();
  return terms.every(term => searchable.includes(term));
}
