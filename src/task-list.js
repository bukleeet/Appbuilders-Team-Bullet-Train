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

export function matchesTask(task, query = '', filter = 'all') {
  if (filter === 'open' && task.status === 'done') return false;
  if (filter === 'done' && task.status !== 'done') return false;
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const searchable = `${task.title} ${task.course || ''}`.toLocaleLowerCase();
  return terms.every(term => searchable.includes(term));
}
