import { planWeek, repairPlan } from './scheduler.js';
import { acceptPlan, undoPlan } from './store.js';
import {recordSessionProgress} from './ui-mutations.js';
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
  recordSessionProgress(state, data);
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
  let lastWindowDate=toLocalDateAndTime(new Date()).date;
  app.insertAdjacentHTML('beforeend', '<dialog id="planner-dialog"><div class="dialog-body"></div></dialog>');
  const dialog=app.querySelector('#planner-dialog'),body=dialog.querySelector('.dialog-body');
  const taskName=id=>titleFor(state,id)||id;
  const focusInBody=selector=>{const target=body.querySelector(selector);if(target){if(!target.matches('button,input,select,textarea,a[href]'))target.tabIndex=-1;target.focus({preventScroll:true});}};
  const save=message=>{
    const result=persist(message,false);
    proposal=null;
    render();
    const feedback=document.createElement('p');
    feedback.className=`planner-feedback${result.ok?'':' warning'}`;
    feedback.setAttribute('role',result.ok?'status':'alert');
    feedback.tabIndex=-1;
    feedback.textContent=result.message;
    body.querySelector('.planner-header').after(feedback);
    feedback.focus({preventScroll:true});
  };
  const windowList=kind=>{
    const entries=[...state[kind]].sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt));
    return entries.length?`<ul class="planner-entries">${entries.map(w=>`<li class="planner-entry"><div><strong>${escape(w.title||'Study time')}</strong><span>${display(w.startAt)} – ${new Date(w.endAt).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'})}</span></div><button type="button" data-remove="${escape(w.id)}" data-kind="${kind}" aria-label="Remove ${escape(w.title||'study time')} on ${display(w.startAt)}">Remove</button></li>`).join('')}</ul>`:'<p class="planner-empty">Nothing added yet.</p>';
  };
  function render(){
    body.innerHTML=`<header class="planner-header"><div><span class="eyebrow">MAKE ROOM FOR YOUR WORK</span><h2 id="planner-title">Study plan</h2><p>Set your study hours and commitments in Philippine time (PHT).</p></div><button type="button" data-close aria-label="Close study plan">Close</button></header>
      <div class="planner-stats" aria-label="Planning summary"><div><strong>${state.availability.length}</strong><span>Study windows</span></div><div><strong>${state.commitments.length}</strong><span>Commitments</span></div><div><strong>${state.blocks.length}</strong><span>Study sessions</span></div></div>
      <section class="planner-section planner-builder" aria-labelledby="planner-add-title"><div class="planner-section-head"><h3 id="planner-add-title">Add time to your week</h3><p>Study windows are hours you can use. Commitments are hours to keep free.</p></div>
        <form id="window-form"><div class="form-row"><label>I'm adding<select name="kind"><option value="availability">Time available to study</option><option value="commitments">A fixed commitment</option></select></label><label class="planner-title-field" hidden>Commitment name<input name="title" maxlength="180" disabled placeholder="e.g. Chemistry lecture"></label></div><div class="form-row three"><label>Date<input name="date" type="date" value="${escape(lastWindowDate)}" required></label><label>Start time<input name="start" type="time" required></label><label>End time<input name="end" type="time" required></label></div><p role="alert" id="window-error"></p><button class="soft" type="submit">Add to schedule</button></form>
      </section>
      <div class="planner-window-lists"><section class="planner-section" aria-labelledby="planner-availability-title"><div class="planner-section-head"><h3 id="planner-availability-title">Study availability</h3><span class="planner-count">${state.availability.length}</span></div>${windowList('availability')}</section><section class="planner-section" aria-labelledby="planner-commitments-title"><div class="planner-section-head"><h3 id="planner-commitments-title">Fixed commitments</h3><span class="planner-count">${state.commitments.length}</span></div>${windowList('commitments')}</section></div>
      <section class="planner-section planner-preview" aria-labelledby="planner-preview-title"><div class="planner-section-head"><h3 id="planner-preview-title">Build your week</h3><p>Preview any changes before applying them to your calendar.</p></div><div class="actions"><button class="primary" data-plan>Preview plan</button><button class="soft" data-repair>Preview recovery</button>${canUndo(state)?'<button class="soft" data-undo>Undo accepted plan</button>':''}</div>${proposal?`<div class="planner-proposal"><h3 id="planner-proposal-title">Proposed changes</h3><p>Your saved plan stays unchanged until you accept.</p><div class="planner-proposal-details">${proposalSummary(proposal,taskName)}</div><div class="actions"><button class="primary" data-accept>Accept plan</button><button class="soft" data-cancel>Cancel preview</button></div></div>`:''}</section>
      <section class="planner-section planner-sessions" aria-labelledby="planner-sessions-title"><div class="planner-section-head"><h3 id="planner-sessions-title">Saved study sessions</h3><span class="planner-count">${state.blocks.length}</span></div>${state.blocks.length?`<div class="planner-session-list">${[...state.blocks].sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt)).map(b=>`<article class="planner-session"><div><strong>${escape(taskName(b.taskId))}</strong><p>${display(b.startAt)} – ${new Date(b.endAt).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'})} <span class="planner-session-status">${escape(b.status.replaceAll('_',' '))}${b.locked?' · Locked':''}</span></p></div>${b.status===BLOCK_STATUS.PLANNED?`<div class="actions"><button data-lock="${escape(b.id)}">${b.locked?'Unlock':'Lock'}</button><button data-partial="${escape(b.id)}">Record partial</button><button data-done="${escape(b.id)}">Done</button><button data-missed="${escape(b.id)}">Missed</button></div>`:''}</article>`).join('')}</div>`:'<p class="planner-empty">No accepted sessions yet. Add available hours, then preview a plan.</p>'}</section>`;
  }
  body.addEventListener('change',e=>{
    if(e.target.name!=='kind')return;
    const isCommitment=e.target.value==='commitments';
    const label=body.querySelector('.planner-title-field');
    label.hidden=!isCommitment;
    const input=label.querySelector('input');
    input.disabled=!isCommitment;
    input.required=isCommitment;
  });
  body.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);if(f.get('end')<=f.get('start')){body.querySelector('#window-error').textContent='End must be later than start on the same day.';return;}
    try{
      const slot={startAt:parseInTimezone(f.get('date'),f.get('start')),endAt:parseInTimezone(f.get('date'),f.get('end'))};
      if(f.get('kind')==='commitments'){const title=f.get('title').trim();if(!title){body.querySelector('#window-error').textContent='Give the commitment a name.';return;}state.commitments.push(createCommitment({...slot,title}));}
      else state.availability.push(createWindow(slot));
      lastWindowDate=f.get('date');
      save('Time added to your schedule.');
    }catch(error){body.querySelector('#window-error').textContent=error.message;}
  });
  body.addEventListener('click',e=>{e.stopPropagation();const d=e.target.closest('button')?.dataset;if(!d)return;
    if('close'in d)dialog.close();
    else if('back'in d){render();focusInBody('#planner-sessions-title');}
    else if(d.remove){state[d.kind]=state[d.kind].filter(w=>w.id!==d.remove);save('Time removed from your schedule.');}
    else if('plan'in d||'repair'in d){proposal=('repair'in d?repairPlan:planWeek)(state,{now:new Date().toISOString()});render();focusInBody('#planner-proposal-title');}
    else if('cancel'in d){proposal=null;render();focusInBody('[data-plan]');}
    else if('accept'in d&&proposal){acceptPlan(state,proposal,'plan');save('Study plan accepted.');}
    else if('undo'in d&&canUndo(state)){undoPlan(state);save('Previous study plan restored.');}
    else if(d.lock){const b=state.blocks.find(b=>b.id===d.lock);b.locked=!b.locked;save('Session lock updated.');}
    else if(d.partial){const b=state.blocks.find(b=>b.id===d.partial);const t=state.tasks.find(t=>t.id===b.taskId),maximum=Math.min(diffMinutes(b.startAt,b.endAt),b.completedMinutes+t.remainingMinutes);if(maximum<=b.completedMinutes)return;body.innerHTML=`<div class="planner-progress"><button type="button" data-back>← Back to study plan</button><span class="eyebrow">SESSION PROGRESS</span><h2 id="planner-title">Record progress</h2><p>How much study time did you complete for <strong>${escape(taskName(b.taskId))}</strong>?</p><form id="progress-form"><label>Minutes completed in this session<input name="minutes" type="number" min="${b.completedMinutes+1}" max="${maximum}" required></label><p class="planner-progress-hint">Enter ${b.completedMinutes+1} to ${maximum} minutes.</p><button class="primary">Save progress</button></form></div>`;focusInBody('[name=minutes]');body.querySelector('form').addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();progress(state,{blockId:b.id,completedMinutes:Number(new FormData(event.target).get('minutes')),status:BLOCK_STATUS.PARTIALLY_COMPLETED});save('Session progress saved. Preview recovery to schedule remaining work.');});}
    else if(d.done){progress(state,{blockId:d.done,status:BLOCK_STATUS.COMPLETED});save('Session marked done.');}
    else if(d.missed){progress(state,{blockId:d.missed,status:BLOCK_STATUS.MISSED});save('Session marked missed. Preview recovery to reschedule it.');}
  });
  dialog.setAttribute('aria-labelledby','planner-title');
  dialog.addEventListener('close',()=>{
    dialog.remove();
    persist('',true);
    const trigger=selectedId&&[...app.querySelectorAll('[data-detail],[data-planner]')].find(button=>button.dataset.detail===selectedId||button.dataset.planner===selectedId);
    (trigger||app.querySelector('[data-planner]'))?.focus({preventScroll:true});
  });render();dialog.showModal();
  if(selectedId){
    const card=body.querySelector(`[data-lock="${CSS.escape(selectedId)}"]`)?.closest('article')||body.querySelector(`[data-remove="${CSS.escape(selectedId)}"]`)?.closest('li');
    card?.scrollIntoView({block:'center'});
    card?.setAttribute('tabindex','-1');
    card?.focus({preventScroll:true});
  }
}
