import { planWeek, repairPlan } from './scheduler.js';
import { acceptPlan, undoPlan, recordProgress } from './store.js';
import { createWindow, createCommitment, BLOCK_STATUS } from './model.js';
import { parseInTimezone, toLocalDateAndTime, diffMinutes } from './dates.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const display = value => new Date(value).toLocaleString('en-PH', {timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const DAY = 86400000;

// Scheduler and store codes shown to students.
export const REASONS = {
  SCHEDULED:'Newly scheduled', STILL_VALID:'Still fits', LOCKED:'Locked', REPLANNED:'Replanned',
  CONFLICTS_COMMITMENT:'Overlaps a fixed commitment', CONFLICTS_BLOCK:'Overlaps another session',
  OUTSIDE_AVAILABILITY:'Outside your study availability', AFTER_DEADLINE:'Ends after the deadline',
  TASK_DONE:'Task is finished', UNKNOWN_TASK:'Task no longer exists', EXCESS_EFFORT:'More time than the task still needs',
  DEADLINE_PASSED:'Deadline has passed', NO_CAPACITY_BEFORE_DEADLINE:'Not enough study time before the deadline',
  NO_CAPACITY:'Not enough study time entered', INVALID_DEADLINE:'Deadline is not a valid date',
  NO_DEADLINE:'No deadline entered', UNRESOLVED_PAST_BLOCK:'A past session was not marked done or missed',
  INVALID_INTERVAL:'An entry has an invalid time', INVALID_TASK:'A task has invalid remaining minutes'
};
export const reason = code => REASONS[code] || code;
// Scheduler warnings name a task or a session; resolve either to the task title.
export const titleFor = (state, id) => (state.tasks.find(t => t.id === id) || state.tasks.find(t => t.id === state.blocks.find(b => b.id === id)?.taskId))?.title;

export const todayStart = (now = new Date()) => Date.parse(parseInTimezone(toLocalDateAndTime(now).date, '00:00'));

const STATUS = {[BLOCK_STATUS.COMPLETED]:'done', [BLOCK_STATUS.PARTIALLY_COMPLETED]:'partial', [BLOCK_STATUS.MISSED]:'missed', [BLOCK_STATUS.PLANNED]:'planned'};

// Flattens v2 blocks and commitments into the session rows the views render. `day` is days from `origin` (Manila midnight).
export function sessionItems(state, origin) {
  const at = iso => ({day:Math.floor((Date.parse(iso)-origin)/DAY), time:toLocalDateAndTime(iso).time});
  const dueDay = task => task.dueAt ? Math.floor((Date.parse(task.dueAt)-origin)/DAY) : null;
  const fixed = state.commitments.map(c => ({id:c.id, kind:'fixed', title:c.title, course:'FIXED COMMITMENT', ...at(c.startAt), startAt:c.startAt, endAt:c.endAt, sessionMinutes:diffMinutes(c.startAt, c.endAt), minutes:0, status:'planned'}));
  const study = state.blocks.flatMap(b => {
    const task = state.tasks.find(t => t.id === b.taskId);
    if (!task) return [];
    return [{id:b.id, taskId:task.id, title:task.title, course:task.course, ...at(b.startAt), startAt:b.startAt, endAt:b.endAt,
      sessionMinutes:diffMinutes(b.startAt, b.endAt), minutes:task.remainingMinutes, dueDay:dueDay(task), dueAt:task.dueAt,
      status:STATUS[b.status] || b.status, locked:b.locked, step:task.steps.find(s => !s.completed)?.title}];
  });
  return [...fixed, ...study].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

// Progress changes tasks and blocks after a plan was accepted, so older undo snapshots would silently erase it.
export function progress(state, data) {
  recordProgress(state, data);
  for (const entry of state.history) entry.snapshot = null;
}
export const canUndo = state => Boolean(state.history.at(-1)?.snapshot);

export const countOpenTasks = sessions => new Set(sessions.filter(t=>t.kind!=='fixed'&&t.status!=='done'&&t.minutes>0).map(t=>t.taskId||t.id)).size;

// Removes a task, its sessions, and every undo snapshot of them so undo cannot bring it back.
export function deleteTask(state, id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  state.blocks = state.blocks.filter(b => b.taskId !== id);
  for (const entry of state.history) {
    if (!entry.snapshot) continue;
    entry.snapshot.tasks = entry.snapshot.tasks?.filter(t => t.id !== id);
    entry.snapshot.blocks = entry.snapshot.blocks?.filter(b => b.taskId !== id);
  }
}

export function proposalSummary(proposal, taskName) {
  const changes = proposal.changes.filter(c => c.type !== 'keep');
  return `${changes.map(c=>`<p>${escape(c.type)}: ${escape(taskName(c.taskId))} · ${escape(reason(c.reason))}${c.before?`<br>Before: ${display(c.before.startAt)} – ${display(c.before.endAt)}`:''}${c.after?`<br>After: ${display(c.after.startAt)} – ${display(c.after.endAt)}`:''}</p>`).join('')||'<p>No changes to your sessions.</p>'}${proposal.unallocated.map(u=>`<p class="warning">${escape(taskName(u.taskId))}: ${u.minutes} min unscheduled · ${escape(reason(u.reason))}</p>`).join('')}${proposal.warnings.map(w=>`<p>${escape(reason(w.code))}${w.id?` · ${escape(taskName(w.id))}`:''}</p>`).join('')}`;
}

export function showPlanner(app, state, persist, selectedId=null) {
  let proposal=null;
  app.insertAdjacentHTML('beforeend', '<dialog id="planner-dialog"><div class="dialog-body"></div></dialog>');
  const dialog=app.querySelector('#planner-dialog'),body=dialog.querySelector('.dialog-body');
  const taskName=id=>titleFor(state,id)||id;
  const save=message=>{const result=persist(message,false);proposal=null;render();const feedback=document.createElement('p');feedback.setAttribute('role',result.ok?'status':'alert');feedback.classList.toggle('warning',!result.ok);feedback.textContent=result.message;body.prepend(feedback);};
  function render(){
    body.innerHTML=`<div class="panel-title"><h2>Study plan</h2><button type="button" data-close>Close</button></div><p>Enter dated study availability in Philippine time. Planning only uses the time you enter here.</p><form id="window-form"><div class="form-row"><label>Type<select name="kind"><option value="availability">Study availability</option><option value="commitments">Fixed commitment</option></select></label><label>Title (commitments)<input name="title" maxlength="180"></label></div><div class="form-row three"><label>Date<input name="date" type="date" required></label><label>Start<input name="start" type="time" required></label><label>End<input name="end" type="time" required></label></div><p role="alert" id="window-error"></p><button class="soft">Add window</button></form><hr>${['availability','commitments'].map(kind=>`<h3>${kind==='availability'?'Study availability':'Fixed commitments'}</h3>${state[kind].map(w=>`<p>${escape(w.title||'Study time')} · ${display(w.startAt)} – ${display(w.endAt)} <button data-remove="${escape(w.id)}" data-kind="${kind}">Remove</button></p>`).join('')||'<p>None entered.</p>'}`).join('')}<div class="actions"><button class="primary" data-plan>Preview plan</button><button class="soft" data-repair>Preview recovery</button>${canUndo(state)?'<button class="soft" data-undo>Undo accepted plan</button>':''}</div>${proposal?`<hr><h3>Proposed plan</h3><p>Your saved plan stays unchanged until you accept.</p>${proposalSummary(proposal,taskName)}<div class="actions"><button class="primary" data-accept>Accept plan</button><button class="soft" data-cancel>Cancel preview</button></div>`:''}<hr><h3>Saved study sessions</h3>${state.blocks.map(b=>`<article class="inset"><strong>${escape(taskName(b.taskId))}</strong><p>${display(b.startAt)} – ${display(b.endAt)} · ${escape(b.status)}${b.locked?' · Locked':''}</p>${b.status===BLOCK_STATUS.PLANNED?`<button data-lock="${escape(b.id)}">${b.locked?'Unlock':'Lock'}</button> <button data-partial="${escape(b.id)}">Record partial</button> <button data-done="${escape(b.id)}">Done</button> <button data-missed="${escape(b.id)}">Missed</button>`:''}</article>`).join('')||'<p>No accepted sessions yet.</p>'}`;
  }
  body.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);if(f.get('end')<=f.get('start')){body.querySelector('#window-error').textContent='End must be later than start on the same day.';return;}
    const slot={startAt:parseInTimezone(f.get('date'),f.get('start')),endAt:parseInTimezone(f.get('date'),f.get('end'))};
    if(f.get('kind')==='commitments'){const title=f.get('title').trim();if(!title){body.querySelector('#window-error').textContent='Give the commitment a title.';return;}state.commitments.push(createCommitment({...slot,title}));}
    else state.availability.push(createWindow(slot));
    save('Planning window saved.');});
  body.addEventListener('click',e=>{e.stopPropagation();const d=e.target.closest('button')?.dataset;if(!d)return;
    if('close'in d)dialog.close();
    else if('back'in d)render();
    else if(d.remove){state[d.kind]=state[d.kind].filter(w=>w.id!==d.remove);save('Planning window removed.');}
    else if('plan'in d||'repair'in d){proposal=('repair'in d?repairPlan:planWeek)(state);render();}
    else if('cancel'in d){proposal=null;render();}
    else if('accept'in d&&proposal){acceptPlan(state,proposal,'plan');save('Study plan accepted.');}
    else if('undo'in d&&canUndo(state)){undoPlan(state);save('Previous study plan restored.');}
    else if(d.lock){const b=state.blocks.find(b=>b.id===d.lock);b.locked=!b.locked;save('Session lock updated.');}
    else if(d.partial){const b=state.blocks.find(b=>b.id===d.partial);const maximum=diffMinutes(b.startAt,b.endAt);body.innerHTML=`<button type="button" data-back>Back to study plan</button><h2>Record progress</h2><form id="progress-form"><label>Minutes completed in this session<input name="minutes" type="number" min="1" max="${maximum}" required></label><button class="primary">Save progress</button></form>`;body.querySelector('form').addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();progress(state,{blockId:b.id,completedMinutes:Number(new FormData(event.target).get('minutes'))});save('Session progress saved. Preview recovery to schedule remaining work.');});}
    else if(d.done){progress(state,{blockId:d.done,status:BLOCK_STATUS.COMPLETED});save('Session marked done.');}
    else if(d.missed){progress(state,{blockId:d.missed,completedMinutes:0,status:BLOCK_STATUS.MISSED});save('Session marked missed. Preview recovery to reschedule it.');}
  });
  dialog.setAttribute('aria-label','Study plan');
  dialog.addEventListener('close',()=>{dialog.remove();persist('',true);});render();dialog.showModal();
  if(selectedId){const card=body.querySelector(`[data-lock="${CSS.escape(selectedId)}"]`)?.closest('article');card?.scrollIntoView({block:'center'});card?.setAttribute('tabindex','-1');card?.focus();}
}
