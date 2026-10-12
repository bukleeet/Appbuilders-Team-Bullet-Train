/** Group the seven displayed days without changing session order. */
export function groupWeekDays(sessions, offset) {
  return Array.from({ length: 7 }, (_, index) => {
    const day = offset + index;
    const items = sessions.filter(session => session.day === day);
    const studyMinutes = items
      .filter(session => session.kind !== 'fixed')
      .reduce((total, session) => total + (session.sessionMinutes || session.minutes || 60), 0);
    return { day, items, studyMinutes };
  });
}

export function renderWeekList(sessions, offset, { fullDate, row }) {
  if (!sessions.length) return '';

  return `<div class="panel week-agenda" aria-label="Weekly agenda">${groupWeekDays(sessions, offset).map(({ day, items, studyMinutes }) => `
    <section class="week-day ${day === 0 ? 'week-day-today' : ''}" aria-labelledby="week-day-${day}">
      <div class="week-day-heading">
        <div class="week-day-title">
          <h2 class="list-date" id="week-day-${day}" ${day === 0 ? 'aria-current="date"' : ''}>${fullDate(day)}</h2>
          ${day === 0 ? '<span class="week-today-badge">Today</span>' : ''}
        </div>
        <span class="week-day-meta">${items.length ? `${items.length} ${items.length === 1 ? 'session' : 'sessions'}` : 'Open day'}${studyMinutes ? ` · ${studyMinutes} min study` : ''}</span>
      </div>
      ${items.length ? `<div class="agenda-items list week-day-sessions">${items.map(item => row(item)).join('')}</div>` : '<p class="week-day-empty">Nothing scheduled for this day.</p>'}
    </section>`).join('')}</div>`;
}
