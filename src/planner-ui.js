import { planWeek, repairPlan } from './scheduler.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();
const display = value => new Date(value).toLocaleString('en-PH', {timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

// Temporary bridge for v1 tasks; Person 3's timestamp contract replaces this.
export function schedulerState(state, base) {
  const at = (n, time) => {const d=new Date(base);d.setDate(d.getDate()+n);return stamp(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,time);};
  return {
    tasks:state.tasks.filter(t=>t.kind!=='fixed').map(t=>({id:t.id,title:t.title,course:t.course,remainingMinutes:t.minutes,status:t.status==='done'?'done':'open',dueAt:t.dueAt ?? (t.dueDay==null?null:at(t.dueDay,'23:59'))})),
    commitments:[...state.tasks.filter(t=>t.kind==='fixed').map(t=>{const startAt=at(t.day,t.time);return {id:t.id,title:t.title,startAt,endAt:new Date(Date.parse(startAt)+(t.sessionMinutes||t.minutes)*60000).toISOString()};}),...(state.planner?.commitments||[])],
    availability:state.planner?.availability||[],blocks:state.planner?.blocks||[]
  };
}

export function plannedSessions(state, base) {
  if (!state.planner?.accepted) return state.tasks;
  const localDate = value => new Date(value).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
  const origin=Date.parse(`${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}-${String(base.getDate()).padStart(2,'0')}T00:00:00+08:00`);
  const convert = (b,t) => ({...t,id:b.id,day:Math.round((Date.parse(`${localDate(b.startAt)}T00:00:00+08:00`)-origin)/86400000),time:new Date(b.startAt).toLocaleTimeString('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit'}),sessionMinutes:(Date.parse(b.endAt)-Date.parse(b.startAt))/60000,status:b.status==='completed'?'done':b.status});
  return [...state.tasks.filter(t=>t.kind==='fixed'),...state.planner.commitments.map(c=>convert(c,{title:c.title,course:'FIXED COMMITMENT',kind:'fixed',minutes:0})),...state.planner.blocks.filter(b=>state.tasks.some(t=>t.id===b.taskId)).map(b=>({...convert(b,state.tasks.find(t=>t.id===b.taskId)),taskId:b.taskId}))];
}

export const countOpenTasks = sessions => new Set(sessions.filter(t=>t.kind!=='fixed'&&t.status!=='done'&&t.minutes>0).map(t=>t.taskId||t.id)).size;

export function deletePlannerTask(state, id) {
  state.tasks=state.tasks.filter(t=>t.id!==id);
  if (state.previous) state.previous=state.previous.filter(t=>t.id!==id);
  if (state.planner) {
    state.planner.blocks=state.planner.blocks.filter(b=>b.taskId!==id);
    if (state.planner.previous) state.planner.previous.blocks=state.planner.previous.blocks.filter(b=>b.taskId!==id);
  }
}

export function showPlanner(app, state, base, persist, selectedId=null) {
  state.planner ??= {availability:[],commitments:[],blocks:[],previous:null};
  const data=state.planner;
  let proposal=null;
  app.insertAdjacentHTML('beforeend', '<dialog id="planner-dialog"><div class="dialog-body"></div></dialog>');
  const dialog=app.querySelector('#planner-dialog'),body=dialog.querySelector('.dialog-body');
  const taskName=id=>state.tasks.find(t=>t.id===id)?.title||id;
  const save=message=>{persist(message,false);proposal=null;render();const feedback=document.createElement('p');feedback.setAttribute('role','status');feedback.textContent=message;body.prepend(feedback);};
  function render(){
    body.innerHTML=`<div class="panel-title"><h2>Study plan</h2><button type="button" data-close>Close</button></div><p>Enter dated study availability in Philippine time. This planner uses the current task list; v1 task dates still shift on later-day reloads.</p><form id="window-form"><div class="form-row"><label>Type<select name="kind"><option value="availability">Study availability</option><option value="commitments">Fixed commitment</option></select></label><label>Title (commitments)<input name="title" maxlength="180"></label></div><div class="form-row three"><label>Date<input name="date" type="date" required></label><label>Start<input name="start" type="time" required></label><label>End<input name="end" type="time" required></label></div><p role="alert" id="window-error"></p><button class="soft">Add window</button></form><hr>${['availability','commitments'].map(kind=>`<h3>${kind==='availability'?'Study availability':'Fixed commitments'}</h3>${data[kind].map(w=>`<p>${escape(w.title||'Study time')} · ${display(w.startAt)} – ${display(w.endAt)} <button data-remove="${escape(w.id)}" data-kind="${kind}">Remove</button></p>`).join('')||'<p>None entered.</p>'}`).join('')}<div class="actions"><button class="primary" data-plan>Preview plan</button><button class="soft" data-repair>Preview recovery</button>${data.previous?'<button class="soft" data-undo>Undo accepted plan</button>':''}</div>${proposal?`<hr><h3>Proposed plan</h3><p>Your saved plan stays unchanged until you accept.</p>${proposal.changes.map(c=>`<p>${escape(c.type)}: ${escape(taskName(c.taskId))} · ${escape(c.reason)}${c.before?`<br>Before: ${display(c.before.startAt)} – ${display(c.before.endAt)}`:''}${c.after?`<br>After: ${display(c.after.startAt)} – ${display(c.after.endAt)}`:''}</p>`).join('')||'<p>No changes.</p>'}${proposal.unallocated.map(u=>`<p class="warning">${escape(taskName(u.taskId))}: ${u.minutes} min unscheduled · ${escape(u.reason)}</p>`).join('')}${proposal.warnings.map(w=>`<p>${escape(w.code)} · ${escape(w.id||'')}</p>`).join('')}<div class="actions"><button class="primary" data-accept>Accept plan</button><button class="soft" data-cancel>Cancel preview</button></div>`:''}<hr><h3>Saved study sessions</h3>${data.blocks.map(b=>`<article class="inset"><strong>${escape(taskName(b.taskId))}</strong><p>${display(b.startAt)} – ${display(b.endAt)} · ${escape(b.status)}${b.locked?' · Locked':''}</p>${b.status==='planned'?`<button data-lock="${escape(b.id)}">${b.locked?'Unlock':'Lock'}</button> <button data-partial="${escape(b.id)}">Record partial</button> <button data-done="${escape(b.id)}">Done</button> <button data-missed="${escape(b.id)}">Missed</button>`:''}</article>`).join('')||'<p>No accepted sessions yet.</p>'}`;
  }
  body.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);if(f.get('end')<=f.get('start')){body.querySelector('#window-error').textContent='End must be later than start on the same day.';return;}data[f.get('kind')].push({id:crypto.randomUUID(),title:f.get('title').trim(),startAt:stamp(f.get('date'),f.get('start')),endAt:stamp(f.get('date'),f.get('end'))});save('Planning window saved.');});
  body.addEventListener('click',e=>{e.stopPropagation();const d=e.target.closest('button')?.dataset;if(!d)return;
    if('close'in d)dialog.close();
    else if('back'in d)render();
    else if(d.remove){data[d.kind]=data[d.kind].filter(w=>w.id!==d.remove);save('Planning window removed.');}
    else if('plan'in d||'repair'in d){proposal=('repair'in d?repairPlan:planWeek)(schedulerState(state,base),{now:new Date().toISOString()});render();}
    else if('cancel'in d){proposal=null;render();}
    else if('accept'in d&&proposal){data.previous={blocks:structuredClone(data.blocks),accepted:!!data.accepted};data.blocks=proposal.blocks;data.accepted=true;save('Study plan accepted.');}
    else if('undo'in d&&data.previous){data.blocks=data.previous.blocks;data.accepted=data.previous.accepted;data.previous=null;save('Previous study plan restored.');}
    else if(d.lock){const b=data.blocks.find(b=>b.id===d.lock);b.locked=!b.locked;save('Session lock updated.');}
else if(d.partial){const b=data.blocks.find(b=>b.id===d.partial);const maximum=Math.min(state.tasks.find(t=>t.id===b.taskId).minutes,(Date.parse(b.endAt)-Date.parse(b.startAt))/60000);if(maximum<=0)return;body.innerHTML=`<button type="button" data-back>Back to study plan</button><h2>Record progress</h2><form id="progress-form"><label>Minutes completed<input name="minutes" type="number" min="1" max="${maximum}" required></label><button class="primary">Save progress</button></form>`;body.querySelector('form').addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();complete(b,Number(new FormData(event.target).get('minutes')),'partially_completed');});}
    else if(d.done||d.missed){const b=data.blocks.find(b=>b.id===(d.done||d.missed));complete(b,d.done?(Date.parse(b.endAt)-Date.parse(b.startAt))/60000:0,d.done?'completed':'missed');}
  });
  function complete(b,minutes,status){if(b.status!=='planned')return;const t=state.tasks.find(t=>t.id===b.taskId);const applied=Math.min(minutes,t.minutes);t.minutes-=applied;t.status=t.minutes?'partial':'done';b.completedMinutes=applied;b.status=status;data.previous=null;save('Session progress saved. Preview recovery to schedule remaining work.');}
  dialog.setAttribute('aria-label','Study plan');
  dialog.addEventListener('close',()=>{dialog.remove();persist('',true);});render();dialog.showModal();
  if(selectedId){const card=body.querySelector(`[data-lock="${CSS.escape(selectedId)}"]`)?.closest('article');card?.scrollIntoView({block:'center'});card?.setAttribute('tabindex','-1');card?.focus();}
}
