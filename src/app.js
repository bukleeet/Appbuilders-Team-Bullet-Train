import {getAIStatus} from './ai-client.js';
import {showTaskForm} from './task-capture.js';
import { loadState, saveState, exportState, importState, acceptPlan, undoPlan, ValidationError } from './store.js';
import { createTask, generateId, BLOCK_STATUS } from './model.js';
import { parseInTimezone, toLocalDateAndTime } from './dates.js';
import { createDemoFixtures } from './fixtures.js';
import { repairPlan } from './scheduler.js';
import { showPlanner, sessionItems, countOpenTasks, deleteTask, todayStart, progress, canUndo, reason, titleFor } from './planner-ui.js';
import { assistantPage } from './assistant-ui.js';

let state = loadState(), page = 'Today', preview = null, selected = null, active = null;
let agendaMode = 'timeline', weekMode = 'grid', offset = 0, notice = '', failed = false, warn = false;
let assistantDraft='';
const ai={ready:false,models:[],error:null,label:'Checking local AI…'};
let probeSequence=0;
async function probe() {
  const sequence=++probeSequence;
  const result=await getAIStatus();
  if(sequence!==probeSequence)return;
  Object.assign(ai,result);
  ai.ready=result.ready&&result.models.includes('qwen3.5:2b');
  ai.label=ai.ready?'Ready · qwen3.5:2b':result.ready?'Model not installed':navigator.onLine?'Not running':'Offline';
  app.querySelectorAll('[data-ai-status]').forEach(el=>{el.textContent=ai.label;});
  const hint=app.querySelector('[data-ai-error]');
  if(hint)hint.textContent=ai.error||'';
}
function resizeAssistantDraft() {
  const field=document.querySelector('#assistant-draft');
  if(!field)return;
  field.style.height='auto';
  field.style.height=`${field.scrollHeight+field.offsetHeight-field.clientHeight}px`;
}
const app = document.querySelector('#app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<img class="icon" src="/public/icons/${name}.svg" alt="" aria-hidden="true">`;
const base = new Date(new Date().toLocaleString('en-US', {timeZone:'Asia/Manila'}));
base.setHours(12,0,0,0);
const day = n => { const d = new Date(base); d.setDate(d.getDate()+n); return d; };
const date = n => day(n).toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric'});
const fullDate = n => day(n).toLocaleDateString('en-PH',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
const minute = time => {const [h,m]=time.split(':').map(Number);return h*60+m;};
const clock = n => { const minutes = ((n % 1440) + 1440) % 1440; return `${Math.floor(minutes/60)%12||12}:${String(minutes%60).padStart(2,'0')} ${minutes>=720?'PM':'AM'}`; };
const length = t => t.sessionMinutes || t.minutes || 60;
const range = t => `${clock(minute(t.time))} – ${clock(minute(t.time)+length(t))}`;
const origin = todayStart();
const sessions = () => sessionItems(state, origin);
const find = id => sessions().find(t=>t.id===id);
const findTask = id => state.tasks.find(t=>t.id===id);
const open = () => state.tasks.filter(t=>t.status!=='done');
const when = iso => new Date(iso).toLocaleString('en-PH',{timeZone:'Asia/Manila',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const span = b => `${when(b.startAt)} – ${new Date(b.endAt).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'})}`;
const nextSession = id => sessions().find(s=>s.taskId===id&&s.status==='planned'&&Date.parse(s.endAt)>Date.now());
const scheduled = id => sessions().filter(s=>s.taskId===id&&s.status==='planned'&&Date.parse(s.endAt)>Date.now()).reduce((sum,s)=>sum+length(s),0);
const tone = t => /KAS|HIST/.test(t.course)?'terracotta':/CS|STAT/.test(t.course)?'sage':'blue';
const status = t => t.kind==='fixed'?'Fixed commitment':t.id===active?'In progress':t.status==='done'?'Completed':t.status==='partial'?'Partially done':t.status==='missed'?'Missed':'Scheduled';

function persist(text='',refresh=true) {
  warn=false;
  try {saveState(state);failed=false;notice=text;} catch (err) {failed=true;notice=err instanceof ValidationError?`Changes could not be saved: ${err.errors[0]||err.message}`:'Changes could not be saved. Keep this page open and export a backup in Settings.';}
  if(refresh)render();
  return {ok:!failed,message:notice};
}
function render() {
  const nav={Today:'calendar',Week:'columns-3',Tasks:'circle-check',Assistant:'notebook',Settings:'settings-2'};
app.innerHTML=`<aside class="sidebar"><div class="brand"><img class="brand-logo" src="/public/waypoint-logo.png" alt=""><span>Waypoint</span></div><nav aria-label="Main navigation">${Object.keys(nav).map(n=>`<button data-page="${n}" class="nav-item ${page===n?'selected':''}" ${page===n?'aria-current="page"':''}>${icon(nav[n])}${n==='Assistant'?'Ask Waypoint':n}</button>`).join('')}</nav></aside><div class="workspace"><header class="topbar"><div class="date-controls"><div class="week-switch"><button data-shift="-7" aria-label="Previous week">${icon('chevron-left')}</button><span>${date(offset)} – ${date(offset+6)}</span><button data-shift="7" aria-label="Next week">${icon('chevron-right')}</button></div><button class="soft" data-today>Today</button></div><div class="connection"><span class="pill ${failed?'error-pill':'saved'}">${failed?'Save failed':'Saved on this device'}</span><span class="pill model"><span data-ai-status>${esc(ai.label)}</span></span></div><button class="primary" data-add>${icon('plus')} Add Task</button></header><main>${notice?`<div class="notice ${failed||warn?'warning':''}" role="status">${esc(notice)}<button data-dismiss aria-label="Dismiss notification">${icon('x')}</button></div>`:''}${canUndo(state)&&!preview?'<button class="undo-button" data-undo>Undo last plan change</button>':''}${preview?recovery():page==='Today'?today():page==='Week'?week():page==='Tasks'?tasks():page==='Assistant'?assistantPage(assistantDraft,ai.label):settings()}</main></div>`;
  if (page === 'Week' && !preview) app.querySelector('main').insertAdjacentHTML('afterbegin', '<button class="primary" data-planner>Manage study plan & recovery</button>');
  resizeAssistantDraft();
  const calendarScroll = app.querySelector('.calendar-scroll');
  if (calendarScroll) calendarScroll.scrollTop = 8 * 120;
}
function hero(t) {
  return `<section class="hero ${tone(t)}"><div class="hero-main"><div class="hero-kicker"><span class="course-tag">${esc(t.course)}</span><span>${icon('clock')} ${t.id===active?'Session in progress':'Next planned session'}</span></div><h2>${esc(t.title)}</h2><div class="hero-meta"><strong>${range(t)}</strong><b>${length(t)} min planned today</b><span>${esc(t.location||'')}</span></div><div class="immediate-step"><small>${icon('flag')} IMMEDIATE STEP</small><p>${esc(t.step||'Open your materials and work on the next unfinished part.')}</p>${t.reference?`<span>Reference: ${esc(t.reference)}</span>`:''}</div><p class="remaining"><strong>${icon('calendar-clock')} ${t.dueAt?`Due ${when(t.dueAt)} PHT`:'Deadline not entered'}</strong><span>${t.minutes} min total remaining · ${length(t)} min in this session</span></p></div><div class="hero-actions"><button class="primary" data-start="${esc(t.id)}">${icon('play')} ${t.id===active?'Session started':'Start Session'}</button><div class="progress-actions"><button class="soft" data-done="${esc(t.id)}">${icon('check')} Done</button><button class="soft" data-partial="${esc(t.id)}">${icon('settings-2')} Partial</button><button class="soft" data-miss="${esc(t.id)}">${icon('rotate-ccw')} Missed</button></div></div></section>`;
}
function row(t,nextId) {
return `<div class="agenda-row ${t.status==='done'?'complete':''}"><span class="timeline-marker ${t.status==='done'?'complete':t.id===nextId?'current':''}">${icon(t.kind==='fixed'?'lock-keyhole':t.status==='done'?'check':'book-open')}</span><article class="agenda-card ${tone(t)} ${t.kind==='fixed'?'fixed-card':t.id===nextId?'current-card':''}"><div class="agenda-card-top"><small>${esc(t.course)}</small><span class="status-tag">${t.id===nextId?'Current selection':status(t)}</span></div><h3>${esc(t.title)}</h3><div class="agenda-card-bottom"><span>${range(t)}${t.location?` · ${esc(t.location)}`:''}</span><button class="text-button" ${t.kind==='fixed'?'data-planner':'data-detail'}="${esc(t.id)}">${icon('square-pen')} ${t.kind==='fixed'?'Manage':'Manage session'}</button></div></article></div>`;
}
function today() {
  const agenda=sessions().filter(t=>t.day===0);
  const next=agenda.find(t=>t.kind!=='fixed'&&t.status==='planned');
  return `<div class="page-meta"><span class="eyebrow">ACADEMIC LEDGER · YOUR WEEK AT A GLANCE</span><span>${icon('calendar')} ${fullDate(0)}<b>${agenda.filter(t=>t.status==='done').length} of ${agenda.length} sessions completed</b></span></div><h1>Today</h1>${next?hero(next):'<section class="hero empty"><h2>A little room for what comes next.</h2><p>Add a task or look ahead to your week.</p><button class="primary" data-add>Add task</button></section>'}<div class="today-columns"><section class="panel agenda"><div class="panel-title"><div><h2>Today’s Agenda</h2><p>${date(0)} · ${agenda.length} scheduled sessions</p></div><div class="segmented"><button data-agenda="timeline" class="${agendaMode==='timeline'?'chosen':''}">${icon('chart-no-axes-column-increasing')} Timeline</button><button data-agenda="list" class="${agendaMode==='list'?'chosen':''}">${icon('list')} List</button></div></div><div class="agenda-items ${agendaMode}">${agenda.map(t=>row(t,next?.id)).join('')||'<p class="muted">Nothing scheduled today.</p>'}</div><footer class="panel-foot">${icon('calendar-clock')} ${agenda.filter(t=>t.kind!=='fixed').reduce((s,t)=>s+length(t),0)} min of planned study<span>Times in PHT</span></footer></section><div class="right-column"><section class="panel next-action"><h2>${icon('calendar-clock')} Keep the week workable</h2><p>Missed a session? Review a proposed move before changing your plan.</p>${state.tasks.length?`<button class="primary compact" data-recover>${icon('rotate-ccw')} Preview recovery</button>`:'<button class="soft" data-page="Week">View your week</button>'}</section><section class="panel deadlines"><div class="panel-title"><h2>Upcoming Work</h2><span class="eyebrow">NEXT 7 DAYS</span></div>${open().filter(t=>t.dueAt&&Date.parse(t.dueAt)>=origin&&Date.parse(t.dueAt)<origin+7*86400000).sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt)).map(t=>`<button class="deadline-card ${tone(t)}" data-edit="${esc(t.id)}"><span><strong>${esc(t.course)}: ${esc(t.title)}</strong><small class="due-tag">${when(t.dueAt)}</small></span><span class="deadline-meta"><small>${scheduled(t.id)} min scheduled</small><small>${t.remainingMinutes} min remaining</small></span><span class="progress-track"><span style="width:${Math.min(100,scheduled(t.id)/Math.max(1,t.remainingMinutes)*100)}%"></span></span></button>`).join('')||'<p class="muted">No deadlines in the next 7 days.</p>'}</section><section class="panel task-queue"><div class="panel-title"><h2>Tasks <span class="count">${open().length}</span></h2><button class="text-button" data-page="Tasks">View all</button></div><p>Small steps, a clear place to start.</p>${open().slice(0,3).map(t=>`<div class="queue-item"><div>${esc(t.title)}<small>${esc(t.course)} · ${t.remainingMinutes} min remaining</small></div><button class="soft compact" data-edit="${esc(t.id)}">${icon('pencil')} Edit</button></div>`).join('')}</section><div class="local-footer">${icon('shield-check')} Task data stays in this browser<span>No cloud sync</span></div></div></div>`;
}
function week() {
  const visible=sessions().filter(t=>t.day>=offset&&t.day<offset+7);
return `<div class="week-summary"><div><span class="eyebrow">PLANNED STUDY</span><strong>${(visible.filter(t=>t.kind!=='fixed').reduce((s,t)=>s+length(t),0)/60).toFixed(1)} <small>hrs</small></strong></div><div><span class="eyebrow">FIXED COMMITMENTS</span><strong>${visible.filter(t=>t.kind==='fixed').length} <small>blocks</small></strong></div><div><span class="eyebrow">OPEN TASKS</span><strong>${countOpenTasks(visible)}</strong></div><div class="week-tools segmented"><button data-week="grid" class="${weekMode==='grid'?'chosen':''}">${icon('columns-3')} Grid</button><button data-week="list" class="${weekMode==='list'?'chosen':''}">${icon('list')} List view</button></div></div>${weekMode==='list'?`<section class="panel">${Array.from({length:7},(_,i)=>`<h2 class="list-date">${fullDate(i+offset)}</h2>${visible.filter(t=>t.day===i+offset).map(t=>row(t)).join('')||'<p class="muted">No sessions scheduled.</p>'}`).join('')}</section>`:`<section class="calendar" aria-label="Weekly calendar"><div class="calendar-head"><div>${icon('clock')}</div>${Array.from({length:7},(_,i)=>`<div class="${i+offset===0?'current-day':''}"><small>${day(i+offset).toLocaleDateString('en-PH',{weekday:'short'}).toUpperCase()}</small><b>${day(i+offset).getDate()}</b><span>${visible.filter(t=>t.day===i+offset&&t.kind!=='fixed').reduce((s,t)=>s+length(t),0)} min study</span></div>`).join('')}</div><div class="calendar-scroll"><div class="calendar-body"><div class="time-gutter">${Array.from({length:24},(_,i)=>`<span style="top:${i*120}px">${String(i).padStart(2,'0')}:00</span>`).join('')}</div>${Array.from({length:7},(_,i)=>`<div class="day-column">${visible.filter(t=>t.day===i+offset).map(t=>`<button class="calendar-block ${tone(t)} ${t.kind==='fixed'?'fixed-block':''} ${t.status==='done'?'completed-block':''}" style="top:${minute(t.time)*120/60}px;height:${Math.max(30,length(t)*120/60)}px" data-detail="${esc(t.id)}"><span class="block-top"><b>${esc((t.course||'').split(' · ')[0])}</b>${t.kind==='fixed'?icon('lock-keyhole'):''}</span><strong>${esc(t.title)}</strong><small>${range(t)}</small></button>`).join('')}</div>`).join('')}</div></div></section>`}<div class="calendar-legend"><span><i class="legend-square fixed-color"></i> Fixed commitments</span><span><i class="legend-square blue-color"></i> Study sessions</span><span>${icon('circle-help')} Select a block to view details</span></div>${selected&&find(selected)?drawer(find(selected)):''}`;
}
function drawer(t) {return `<div class="drawer-backdrop" data-close-detail></div><section class="detail-drawer" aria-label="Session details"><div class="panel-title"><span class="course-tag">${esc(t.course)}</span><button class="icon-button" data-close-detail aria-label="Close details">${icon('x')}</button></div><h2>${esc(t.title)}</h2><div class="inset"><small>SCHEDULED SESSION</small><p>${date(t.day)} · ${range(t)}</p><span>${status(t)}</span></div><h3>Next step</h3><p>${esc(t.step||'Work on the next unfinished part.')}</p><div class="drawer-actions">${t.kind==='fixed'?`<button class="primary" data-planner="${esc(t.id)}">Manage in study plan</button>`:`<button class="primary" data-edit="${esc(t.taskId)}">Edit task</button>${t.status==='planned'?`<button class="soft" data-done="${esc(t.id)}">Mark done</button><button class="soft" data-partial="${esc(t.id)}">Partial</button><button class="soft" data-miss="${esc(t.id)}">Missed · recover</button><button class="soft" data-lock="${esc(t.id)}">${t.locked?'Unlock':'Lock'} session</button>`:''}`}</div></section>`;}
function tasks() {return `<span class="eyebrow">A LITTLE STRUCTURE FOR EVERYTHING AHEAD</span><h1>Tasks</h1><section class="panel task-table"><div class="task-table-head"><span>TASK / COURSE</span><span>DUE · NEXT SESSION</span><span>REMAINING</span><span>ACTIONS</span></div>${state.tasks.map(t=>{const s=nextSession(t.id);return `<div class="task-table-row ${t.status==='done'?'complete':''}"><div><small>${esc(t.course)}</small><h3>${esc(t.title)}</h3><span class="status-tag">${t.status==='done'?'Completed':s?'Scheduled':'Not scheduled'}</span></div><span>${t.dueAt?`Due ${when(t.dueAt)}`:'No deadline'}<small>${s?`${date(s.day)} · ${range(s)}`:'No upcoming session'}</small></span><span>${t.remainingMinutes} min</span><div class="actions"><button class="soft compact" data-edit="${esc(t.id)}">${icon('pencil')} Edit</button><button class="icon-button" data-delete="${esc(t.id)}" aria-label="Delete ${esc(t.title)}">${icon('x')}</button></div></div>`;}).join('')||'<p>Add your first task to begin.</p>'}</section>`;}
function settings() {return `<span class="eyebrow">YOUR WORKSPACE</span><h1>Settings</h1><div class="settings-grid"><section class="panel"><h2>Local data</h2><p>Your tasks stay in this browser. Export a backup before clearing browser data.</p><div class="actions"><button class="primary" data-export>${icon('download')} Export JSON backup</button><button class="soft" data-import>Import backup</button></div><input type="file" id="import-file" accept="application/json,.json" hidden><hr><h3>Sample week</h3><p>Try the complete sample layout. Loading it replaces your tasks; export a backup first.</p><button class="soft" data-sample>Load sample week</button></section><section class="panel"><h2>Local AI</h2><span class="pill model" data-ai-status>${esc(ai.label)}</span><p data-ai-error>${esc(ai.error||'')}</p><p>Describe a task in Add Task or Ask Waypoint, then review it before saving. Manual entry always works.</p><button class="soft" data-probe>Check connection</button><hr><h3>Timezone</h3><p>Asia/Manila · Philippine Standard Time (UTC+8)</p><p class="muted">No cloud synchronization is enabled.</p></section></div>`;}
function recovery() {
  const {proposal,missed}=preview,changes=proposal.changes.filter(c=>c.type!=='keep'),kept=proposal.changes.length-changes.length;
  const label=id=>{const t=findTask(id);return t?`${esc(t.course)}: ${esc(t.title)}`:'Removed task';};
  const moved=changes.filter(c=>c.after).reduce((sum,c)=>sum+(Date.parse(c.after.endAt)-Date.parse(c.after.startAt))/60000,0);
  return `<div class="preview-notice">${icon('circle-help')}<div><b>Preview mode</b><p>Your current calendar stays unchanged until you accept.</p></div><span class="pill model">Scheduler proposal</span></div><section class="recovery-shell"><div class="recovery-heading"><span class="eyebrow">SCHEDULE RECOVERY</span><h1>Plan Recovery Preview</h1><p>${missed?`${esc(missed)} was marked missed.`:'Remaining work is fitted into your study availability.'}</p><p class="muted">Only the study availability you entered is used. Fixed commitments, locked sessions and deadlines are respected.</p></div><div class="recovery-columns"><div><h3 class="eyebrow diff-heading">PROPOSED CHANGES</h3>${changes.map(c=>`<article class="move-card">${icon(c.type==='remove'?'x':'arrow-right')}<div><h3>${label(c.taskId)}</h3>${c.before?`<p><del>${span(c.before)}</del></p>`:''}${c.after?`<strong>${span(c.after)}</strong>`:''}<p class="muted">${esc(reason(c.reason))}</p></div></article>`).join('')||'<p>No changes needed. Your sessions already fit.</p>'}${proposal.unallocated.map(u=>`<p class="warning">${label(u.taskId)}: ${u.minutes} min could not be scheduled · ${esc(reason(u.reason))}</p>`).join('')}${state.availability.length?'':'<p class="warning">No study availability entered yet. Add it under Week → Manage study plan & recovery.</p>'}<div class="protected-note">${icon('lock-keyhole')} Locked and completed sessions stay unchanged.</div></div><div><div class="recovery-stats"><article class="panel"><small>UNCHANGED SESSIONS</small><strong>${kept}</strong></article><article class="panel"><small>MINUTES RESCHEDULED</small><strong>${moved}<small> min</small></strong></article></div>${proposal.warnings.length?`<div class="inset"><h3>Worth checking</h3>${proposal.warnings.map(w=>`<p>${esc(reason(w.code))}${titleFor(state,w.id)?` · ${esc(titleFor(state,w.id))}`:''}</p>`).join('')}</div>`:''}</div></div><footer class="recovery-footer"><button class="soft" data-cancel>Keep Current Plan</button><button class="primary" data-accept ${changes.length?'':'disabled'}>${icon('check')} Accept Changes & Update Week</button></footer></section>`;
}
function showTask(t=null,text='') { showTaskForm(app,state,persist,ai,t,text); }
function confirmAction(title, text, action, value = '') {
  app.insertAdjacentHTML('beforeend', `<dialog id="confirmation-dialog"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions"><button class="soft" data-close-dialog>Cancel</button><button class="primary" data-${action}="${esc(value)}">Confirm</button></div></dialog>`);
  const dialog = document.querySelector('#confirmation-dialog');
  dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove());
}
app.addEventListener('click',e=>{
  if(e.target.classList.contains('drawer-backdrop')){selected=null;render();return;}
  const button=e.target.closest('button');if(!button)return;const d=button.dataset;
  if(d.page){page=d.page;preview=null;selected=null;render();if(page==='Settings'||page==='Assistant')probe();}
  else if(d.shift){offset+=Number(d.shift);page='Week';preview=null;render();}
  else if('today'in d){offset=0;page='Today';preview=null;render();}
  else if(d.prompt){assistantDraft=d.prompt;render();document.querySelector('#assistant-draft').focus();}
  else if('planner'in d){selected=null;showPlanner(app,state,persist,d.planner||null);}
  else if('probe'in d)probe();
  else if('capture'in d)showTask(null,assistantDraft);
  else if('add'in d)showTask();
  else if(d.edit){const task=findTask(d.edit);if(task)showTask(task);}
  else if('closeDialog'in d)document.querySelector('dialog')?.close();
  else if(d.agenda){
    if(agendaMode===d.agenda)return;
    const items=app.querySelector('.agenda-items');
    const before=new Map([...items.querySelectorAll('.agenda-card')].map(card=>[card,card.getBoundingClientRect()]));
    agendaMode=d.agenda;
    items.classList.toggle('timeline',agendaMode==='timeline');
    items.classList.toggle('list',agendaMode==='list');
    app.querySelectorAll('[data-agenda]').forEach(button=>button.classList.toggle('chosen',button.dataset.agenda===agendaMode));
    if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      before.forEach((rect,card)=>{const after=card.getBoundingClientRect();card.animate([{transform:`translate(${rect.left-after.left}px,${rect.top-after.top}px) scaleX(${rect.width/after.width})`},{transform:'none'}],{duration:220,easing:'cubic-bezier(.2,.7,.2,1)'});});
    }
  }
  else if(d.week){weekMode=d.week;render();}
  else if(d.detail){if(find(d.detail)?.kind==='fixed'){showPlanner(app,state,persist,d.detail);return;}selected=d.detail;page='Week';render();}
  else if('closeDetail'in d){selected=null;render();}
  else if(d.start){active=d.start;notice='Session started.';render();}
  else if(d.done){progress(state,{blockId:d.done,status:BLOCK_STATUS.COMPLETED});if(active===d.done)active=null;selected=null;persist('Session completed. Remaining work updated.');}
  else if(d.partial){const t=find(d.partial),b=state.blocks.find(b=>b.id===t.id),maximum=Math.min(length(t),b.completedMinutes+findTask(t.taskId).remainingMinutes);if(maximum<=b.completedMinutes)return;app.insertAdjacentHTML('beforeend',`<dialog id="partial-dialog"><form id="partial-form"><h2>How much did you finish?</h2><input type="hidden" name="id" value="${esc(t.id)}"><label>Minutes completed in this session<input name="completed" type="number" required min="${b.completedMinutes+1}" max="${maximum}" value="${Math.min(maximum,Math.max(b.completedMinutes+1,Math.floor(maximum/2)))}"></label><div class="actions"><button type="button" data-close-dialog>Cancel</button><button class="primary">Save Progress</button></div></form></dialog>`);const dialog=document.querySelector('#partial-dialog');dialog.showModal();dialog.addEventListener('close',()=>dialog.remove());}
  else if(d.miss){const t=find(d.miss);progress(state,{blockId:t.id,status:BLOCK_STATUS.MISSED});if(active===t.id)active=null;const saved=persist('',false);preview={proposal:repairPlan(state,{now:new Date().toISOString()}),missed:t.title};selected=null;if(!saved.ok)notice=saved.message;render();window.scrollTo(0,0);}
  else if('recover'in d){preview={proposal:repairPlan(state,{now:new Date().toISOString()})};selected=null;render();window.scrollTo(0,0);}
  else if('cancel'in d){preview=null;render();}
  else if('accept'in d&&preview){acceptPlan(state,preview.proposal,'recovery');preview=null;persist('Recovery plan saved. You can undo it.');}
  else if('undo'in d&&canUndo(state)){undoPlan(state);persist('Previous plan restored.');}
  else if(d.lock){const b=state.blocks.find(b=>b.id===d.lock);b.locked=!b.locked;persist(b.locked?'Session locked. Recovery will not move it.':'Session unlocked.');}
  else if('dismiss'in d){notice='';render();}
  else if(d.delete) confirmAction('Delete task?', 'This removes the task and its sessions from your planner.', 'confirm-delete', d.delete);
  else if(d.confirmDelete){deleteTask(state,d.confirmDelete);persist('Task deleted.');}
  else if('sample'in d) confirmAction('Load sample week?', 'This replaces your current tasks. Export a backup first if you want to keep them.', 'confirm-sample');
  else if('confirmSample'in d){state=createDemoFixtures();preview=null;selected=null;persist('Sample week loaded.');}
  else if('import'in d)document.querySelector('#import-file')?.click();
  else if('export'in d){try{const url=URL.createObjectURL(new Blob([exportState(state)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='weekback-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(err){notice=`Export failed: ${err.errors?.[0]||err.message}`;warn=true;render();}}
});
app.addEventListener('change',async e=>{if(e.target.id!=='import-file'||!e.target.files[0])return;try{state=importState(await e.target.files[0].text()).state;preview=null;selected=null;failed=false;warn=false;notice='Backup imported.';}catch(err){warn=true;notice=`${err.message}${err.errors?.length?` (${err.errors[0]})`:''}`;}render();});
app.addEventListener('input',e=>{if(e.target.id==='assistant-draft'){assistantDraft=e.target.value;resizeAssistantDraft();}});
window.addEventListener('resize',resizeAssistantDraft);
app.addEventListener('submit',e=>{
  e.preventDefault();const f=new FormData(e.target);
  if(e.target.getAttribute('id')==='partial-form'){progress(state,{blockId:f.get('id'),completedMinutes:Number(f.get('completed')),status:BLOCK_STATUS.PARTIALLY_COMPLETED});document.querySelector('#partial-dialog')?.close();persist('Progress saved.');}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&selected){selected=null;render();}});
render();probe();window.addEventListener('online',probe);window.addEventListener('offline',probe);
