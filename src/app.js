import { load, save, seed } from './store.js';
import { showPlanner, plannedSessions, countOpenTasks, deletePlannerTask } from './planner-ui.js';
import { assistantPage } from './assistant-ui.js';

let state = load(), page = 'Today', preview = null, selected = null;
let agendaMode = 'timeline', weekMode = 'grid', offset = 0, notice = '', failed = false;
let assistantDraft='';
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
const find = id => state.tasks.find(t=>t.id===id);
const open = () => state.tasks.filter(t=>t.kind!=='fixed'&&t.status!=='done');
const tone = t => /KAS|HIST/.test(t.course)?'terracotta':/CS|STAT/.test(t.course)?'sage':'blue';
const status = t => t.kind==='fixed'?'Fixed commitment':t.status==='done'?'Completed':t.status==='active'?'In progress':t.status==='partial'?'Partially done':'Scheduled';

function persist(text='',refresh=true) {
  try {save(state);failed=false;notice=text;} catch {failed=true;notice='Changes could not be saved. Keep this page open and export a backup in Settings.';}
  if(refresh)render();
  return {ok:!failed,message:notice};
}
function render() {
  const nav={Today:'calendar',Week:'columns-3',Tasks:'circle-check',Settings:'settings-2'};
app.innerHTML=`<aside class="sidebar"><div class="brand"><img class="brand-logo" src="/public/waypoint-logo.png" alt=""><span>Waypoint</span></div><nav aria-label="Main navigation">${Object.keys(nav).map(n=>`<button data-page="${n}" class="nav-item ${page===n?'selected':''}" ${page===n?'aria-current="page"':''}>${icon(nav[n])}${n}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="local-note">${icon('shield-check')} Saved in this browser</div><button class="profile" data-page="Assistant">${icon('notebook')}<span>Ask Waypoint<small>Your schedule assistant</small></span></button></div></aside><div class="workspace"><header class="topbar"><div class="date-controls"><div class="week-switch"><button data-shift="-7" aria-label="Previous week">${icon('chevron-left')}</button><span>${date(offset)} – ${date(offset+6)}</span><button data-shift="7" aria-label="Next week">${icon('chevron-right')}</button></div><button class="soft" data-today>Today</button></div><div class="connection"><span class="pill ${failed?'error-pill':'saved'}">${failed?'Save failed':'Saved on this device'}</span><span class="pill model">${icon(navigator.onLine?'circle-help':'wifi-off')}${navigator.onLine?'Local AI not connected':'Offline · manual mode'}</span></div><button class="primary" data-add>${icon('plus')} Add Task</button></header><main>${notice?`<div class="notice ${failed?'warning':''}" role="status">${esc(notice)}<button data-dismiss aria-label="Dismiss notification">${icon('x')}</button></div>`:''}${state.previous&&!preview?'<button class="undo-button" data-undo>Undo last recovery</button>':''}${preview?recovery():page==='Today'?today():page==='Week'?week():page==='Tasks'?tasks():page==='Assistant'?assistantPage(assistantDraft):settings()}</main></div>`;
  if (page === 'Week' && !preview) app.querySelector('main').insertAdjacentHTML('afterbegin', '<button class="primary" data-planner>Manage study plan & recovery</button>');
  resizeAssistantDraft();
  const calendarScroll = app.querySelector('.calendar-scroll');
  if (calendarScroll) calendarScroll.scrollTop = 8 * 120;
}
function hero(t) {
  return `<section class="hero ${tone(t)}"><div class="hero-main"><div class="hero-kicker"><span class="course-tag">${esc(t.course)}</span><span>${icon('clock')} ${t.status==='active'?'Session in progress':'Next planned session'}</span></div><h2>${esc(t.title)}</h2><div class="hero-meta"><strong>${range(t)}</strong><b>${length(t)} min planned today</b><span>${esc(t.location||'')}</span></div><div class="immediate-step"><small>${icon('flag')} IMMEDIATE STEP</small><p>${esc(t.step||'Open your materials and work on the next unfinished part.')}</p>${t.reference?`<span>Reference: ${esc(t.reference)}</span>`:''}</div><p class="remaining"><strong>${icon('calendar-clock')} ${t.dueDay!=null?`Due ${date(t.dueDay)} at 11:59 PM PHT`:'Deadline not entered'}</strong><span>${t.minutes} min total remaining · ${length(t)} min in this session</span></p></div><div class="hero-actions"><button class="primary" data-start="${esc(t.id)}">${icon('play')} ${t.status==='active'?'Session started':'Start Session'}</button><div class="progress-actions"><button class="soft" data-done="${esc(t.id)}">${icon('check')} Done</button><button class="soft" data-partial="${esc(t.id)}">${icon('settings-2')} Partial</button><button class="soft" data-miss="${esc(t.id)}">${icon('rotate-ccw')} Missed</button></div></div></section>`;
}
function row(t,nextId) {
return `<div class="agenda-row ${t.status==='done'?'complete':''}"><span class="timeline-marker ${t.status==='done'?'complete':t.id===nextId?'current':''}">${icon(t.kind==='fixed'?'lock-keyhole':t.status==='done'?'check':'book-open')}</span><article class="agenda-card ${tone(t)} ${t.kind==='fixed'?'fixed-card':t.id===nextId?'current-card':''}"><div class="agenda-card-top"><small>${esc(t.course)}</small><span class="status-tag">${t.id===nextId?'Current selection':status(t)}</span></div><h3>${esc(t.title)}</h3><div class="agenda-card-bottom"><span>${range(t)}${t.location?` · ${esc(t.location)}`:''}</span><button class="text-button" ${t.taskId?'data-detail':'data-edit'}="${esc(t.id)}">${icon('square-pen')} ${t.taskId?'Manage session':'Edit'}</button></div></article></div>`;
}
function today() {
  const agenda=state.tasks.filter(t=>t.day===0).sort((a,b)=>minute(a.time)-minute(b.time));
  const next=agenda.find(t=>t.kind!=='fixed'&&t.status!=='done');
  return `<div class="page-meta"><span class="eyebrow">ACADEMIC LEDGER · YOUR WEEK AT A GLANCE</span><span>${icon('calendar')} ${fullDate(0)}<b>${agenda.filter(t=>t.status==='done').length} of ${agenda.length} sessions completed</b></span></div><h1>Today</h1>${next?hero(next):'<section class="hero empty"><h2>A little room for what comes next.</h2><p>Add a task or look ahead to your week.</p><button class="primary" data-add>Add task</button></section>'}<div class="today-columns"><section class="panel agenda"><div class="panel-title"><div><h2>Today’s Agenda</h2><p>${date(0)} · ${agenda.length} scheduled sessions</p></div><div class="segmented"><button data-agenda="timeline" class="${agendaMode==='timeline'?'chosen':''}">${icon('chart-no-axes-column-increasing')} Timeline</button><button data-agenda="list" class="${agendaMode==='list'?'chosen':''}">${icon('list')} List</button></div></div><div class="agenda-items ${agendaMode}">${agenda.map(t=>row(t,next?.id)).join('')||'<p class="muted">Nothing scheduled today.</p>'}</div><footer class="panel-foot">${icon('calendar-clock')} ${agenda.filter(t=>t.kind!=='fixed').reduce((s,t)=>s+length(t),0)} min of planned study<span>Times in PHT</span></footer></section><div class="right-column"><section class="panel next-action"><h2>${icon('calendar-clock')} Keep the week workable</h2><p>Missed a session? Review a proposed move before changing your plan.</p>${next?`<button class="primary compact" data-miss="${esc(next.id)}">${icon('rotate-ccw')} Preview recovery</button>`:'<button class="soft" data-page="Week">View your week</button>'}</section><section class="panel deadlines"><div class="panel-title"><h2>Upcoming Work</h2><span class="eyebrow">NEXT 7 DAYS</span></div>${open().filter(t=>t.day>=0&&t.day<7).sort((a,b)=>a.day-b.day).map(t=>`<button class="deadline-card ${tone(t)}" data-detail="${esc(t.id)}"><span><strong>${esc(t.course)}: ${esc(t.title)}</strong><small class="due-tag">${date(t.dueDay??t.day)}</small></span><span class="deadline-meta"><small>${length(t)} min scheduled</small><small>${t.minutes} min remaining</small></span><span class="progress-track"><span style="width:${Math.min(100,length(t)/Math.max(1,t.minutes)*100)}%"></span></span></button>`).join('')||'<p class="muted">No upcoming tasks.</p>'}</section><section class="panel task-queue"><div class="panel-title"><h2>Tasks <span class="count">${open().length}</span></h2><button class="text-button" data-page="Tasks">View all</button></div><p>Small steps, a clear place to start.</p>${open().slice(0,3).map(t=>`<div class="queue-item"><div>${esc(t.title)}<small>${esc(t.course)} · ${t.minutes} min remaining</small></div><button class="soft compact" data-edit="${esc(t.id)}">${icon('pencil')} Edit</button></div>`).join('')}</section><div class="local-footer">${icon('shield-check')} Task data stays in this browser<span>No cloud sync</span></div></div></div>`;
}
function week() {
  const visible=plannedSessions(state,base).filter(t=>t.day>=offset&&t.day<offset+7);
return `<div class="week-summary"><div><span class="eyebrow">PLANNED STUDY</span><strong>${(visible.filter(t=>t.kind!=='fixed').reduce((s,t)=>s+length(t),0)/60).toFixed(1)} <small>hrs</small></strong></div><div><span class="eyebrow">FIXED COMMITMENTS</span><strong>${visible.filter(t=>t.kind==='fixed').length} <small>blocks</small></strong></div><div><span class="eyebrow">OPEN TASKS</span><strong>${countOpenTasks(visible)}</strong></div><div class="week-tools segmented"><button data-week="grid" class="${weekMode==='grid'?'chosen':''}">${icon('columns-3')} Grid</button><button data-week="list" class="${weekMode==='list'?'chosen':''}">${icon('list')} List view</button></div></div>${weekMode==='list'?`<section class="panel">${Array.from({length:7},(_,i)=>`<h2 class="list-date">${fullDate(i+offset)}</h2>${visible.filter(t=>t.day===i+offset).map(t=>row(t)).join('')||'<p class="muted">No sessions scheduled.</p>'}`).join('')}</section>`:`<section class="calendar" aria-label="Weekly calendar"><div class="calendar-head"><div>${icon('clock')}</div>${Array.from({length:7},(_,i)=>`<div class="${i+offset===0?'current-day':''}"><small>${day(i+offset).toLocaleDateString('en-PH',{weekday:'short'}).toUpperCase()}</small><b>${day(i+offset).getDate()}</b><span>${visible.filter(t=>t.day===i+offset&&t.kind!=='fixed').reduce((s,t)=>s+length(t),0)} min study</span></div>`).join('')}</div><div class="calendar-scroll"><div class="calendar-body"><div class="time-gutter">${Array.from({length:24},(_,i)=>`<span style="top:${i*120}px">${String(i).padStart(2,'0')}:00</span>`).join('')}</div>${Array.from({length:7},(_,i)=>`<div class="day-column">${visible.filter(t=>t.day===i+offset).map(t=>`<button class="calendar-block ${tone(t)} ${t.kind==='fixed'?'fixed-block':''} ${t.status==='done'?'completed-block':''}" style="top:${minute(t.time)*120/60}px;height:${Math.max(30,length(t)*120/60)}px" data-detail="${esc(t.id)}"><span class="block-top"><b>${esc(t.course.split(' · ')[0])}</b>${t.kind==='fixed'?icon('lock-keyhole'):''}</span><strong>${esc(t.title)}</strong><small>${range(t)}</small></button>`).join('')}</div>`).join('')}</div></div></section>`}<div class="calendar-legend"><span><i class="legend-square fixed-color"></i> Fixed commitments</span><span><i class="legend-square blue-color"></i> Study sessions</span><span>${icon('circle-help')} Select a block to view details</span></div>${selected&&find(selected)?drawer(find(selected)):''}`;
}
function drawer(t) {return `<div class="drawer-backdrop" data-close-detail></div><section class="detail-drawer" aria-label="Session details"><div class="panel-title"><span class="course-tag">${esc(t.course)}</span><button class="icon-button" data-close-detail aria-label="Close details">${icon('x')}</button></div><h2>${esc(t.title)}</h2><div class="inset"><small>SCHEDULED SESSION</small><p>${date(t.day)} · ${range(t)}</p><span>${status(t)}</span></div><h3>Next step</h3><p>${esc(t.step||'Work on the next unfinished part.')}</p><div class="drawer-actions"><button class="primary" data-edit="${esc(t.id)}">Edit session</button>${t.kind!=='fixed'?`<button class="soft" data-done="${esc(t.id)}">Mark done</button><button class="soft" data-miss="${esc(t.id)}">Preview recovery</button>`:''}</div></section>`;}
function tasks() {return `<span class="eyebrow">A LITTLE STRUCTURE FOR EVERYTHING AHEAD</span><h1>Tasks</h1><section class="panel task-table"><div class="task-table-head"><span>TASK / COURSE</span><span>SESSION</span><span>REMAINING</span><span>ACTIONS</span></div>${state.tasks.filter(t=>t.kind!=='fixed').map(t=>`<div class="task-table-row ${t.status==='done'?'complete':''}"><div><small>${esc(t.course)}</small><h3>${esc(t.title)}</h3><span class="status-tag">${status(t)}</span></div><span>${date(t.day)}<small>${range(t)}</small></span><span>${t.minutes} min</span><div class="actions"><button class="soft compact" data-edit="${esc(t.id)}">${icon('pencil')} Edit</button><button class="icon-button" data-delete="${esc(t.id)}" aria-label="Delete ${esc(t.title)}">${icon('x')}</button></div></div>`).join('')||'<p>Add your first task to begin.</p>'}</section>`;}
function settings() {return `<span class="eyebrow">YOUR WORKSPACE</span><h1>Settings</h1><div class="settings-grid"><section class="panel"><h2>Local data</h2><p>Your tasks stay in this browser. Export a backup before clearing browser data.</p><button class="primary" data-export>${icon('download')} Export JSON backup</button><hr><h3>Sample week</h3><p>Try the complete sample layout. Loading it replaces your tasks; export a backup first.</p><button class="soft" data-sample>Load sample week</button></section><section class="panel"><h2>Local AI</h2><span class="pill model">Not connected</span><p>Manual task entry is available. Local interpretation and automatic scheduling are still being implemented.</p><hr><h3>Timezone</h3><p>Asia/Manila · Philippine Standard Time (UTC+8)</p><p class="muted">No cloud synchronization is enabled.</p></section></div>`;}
function recovery() {
  const t=find(preview.id);
  return `<div class="preview-notice">${icon('circle-help')}<div><b>Preview mode</b><p>Your current calendar stays unchanged until you accept.</p></div><span class="pill model">Manual proposal</span></div><section class="recovery-shell"><div class="recovery-heading"><span class="eyebrow">SCHEDULE RECOVERY</span><h1>Plan Recovery Preview</h1><p>${esc(t.title)} · ${length(t)} min session</p><p class="muted">This initial version proposes a manual move. Availability, overlaps, and deadlines are not checked yet.</p></div><div class="recovery-columns"><div><div class="inset"><h2>Choose where to pick up again</h2><label>Proposed day<select id="recovery-day">${Array.from({length:7},(_,i)=>`<option value="${i}" ${preview.day===i?'selected':''}>${fullDate(i)}</option>`).join('')}</select></label><p>Check this time against your other commitments before accepting.</p></div><h3 class="eyebrow diff-heading">PROPOSED CHANGE</h3><article class="move-card">${icon('arrow-right')}<div><h3>${esc(t.course)}: ${esc(t.title)}</h3><p><del>${date(t.day)} · ${range(t)}</del></p><strong>${date(preview.day)} · ${range(t)}</strong></div></article><div class="protected-note">${icon('lock-keyhole')} Other sessions stay unchanged.</div></div><div><div class="recovery-stats"><article class="panel"><small>UNCHANGED SESSIONS</small><strong>${state.tasks.length-1}</strong></article><article class="panel"><small>PROPOSED MOVE</small><strong>${length(t)}<small> min</small></strong></article></div><div class="inset"><h3>A fresh place to start</h3><p>${esc(t.step||'Open your materials and continue from where you left off.')}</p></div></div></div><footer class="recovery-footer"><button class="soft" data-cancel>Keep Current Plan</button><button class="primary" data-accept ${preview.day===t.day?'disabled':''}>${icon('check')} Accept Move & Update Week</button></footer></section>`;
}
function showTask(t=null) {
  const weekStart = t ? Math.floor(t.day/7)*7 : (page === 'Week' ? offset : 0);
  const selectedDay = t?.day ?? weekStart;
  app.insertAdjacentHTML('beforeend',`<dialog id="task-dialog"><form id="task-form"><div class="dialog-head"><h2>${t?'Edit Session':'Add Task'}</h2><span class="pill saved">Saved locally</span><button class="icon-button" type="button" data-close-dialog aria-label="Close task dialog">${icon('x')}</button></div><div class="dialog-body"><div class="inset capture"><h3>${icon('square-pen')} Quick Capture</h3><p>Local interpretation is not connected yet. Enter the details below.</p><textarea disabled aria-label="Quick capture unavailable" placeholder="MATH 54 problem set due Friday, about 2 hours"></textarea></div><span class="eyebrow">SESSION DETAILS</span><input type="hidden" name="id" value="${esc(t?.id||'')}"><label>Task title<input name="title" required maxlength="180" value="${esc(t?.title||'')}" placeholder="What do you need to work on?"></label><div class="form-row"><label>Course<input name="course" required maxlength="60" value="${esc(t?.course||'')}" placeholder="e.g. MATH 54"></label><label>Remaining work (minutes)<input name="minutes" type="number" min="0" max="1440" value="${t?.minutes??60}" required></label></div><div class="form-row three"><label>Session day<select name="day">${Array.from({length:7},(_,i)=>{const value=weekStart+i;return `<option value="${value}" ${value===selectedDay?'selected':''}>${date(value)}</option>`}).join('')}</select></label><label>Start time<input name="time" type="time" value="${esc(t?.time||'14:00')}" required></label><label>Session minutes<input name="sessionMinutes" type="number" min="15" max="480" value="${t?length(t):60}" required></label></div><label>Next step (optional)<input name="step" maxlength="250" value="${esc(t?.step||'')}" placeholder="A small, concrete place to start"></label><p id="form-error" role="alert"></p></div><footer class="dialog-footer"><button class="text-button" type="button" data-close-dialog>Cancel</button><button class="primary">${icon('check')} ${t?'Save Changes':'Save Task'}</button></footer></form></dialog>`);
  const dialog=document.querySelector('#task-dialog');dialog.showModal();dialog.addEventListener('close',()=>dialog.remove());document.querySelector('[name="title"]').focus();
}
function confirmAction(title, text, action, value = '') {
  app.insertAdjacentHTML('beforeend', `<dialog id="confirmation-dialog"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions"><button class="soft" data-close-dialog>Cancel</button><button class="primary" data-${action}="${esc(value)}">Confirm</button></div></dialog>`);
  const dialog = document.querySelector('#confirmation-dialog');
  dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove());
}
app.addEventListener('click',e=>{
  if(e.target.classList.contains('drawer-backdrop')){selected=null;render();return;}
  const button=e.target.closest('button');if(!button)return;const d=button.dataset;
  if(d.page){page=d.page;preview=null;selected=null;render();}
  else if(d.shift){offset+=Number(d.shift);page='Week';preview=null;render();}
  else if('today'in d){offset=0;page='Today';preview=null;render();}
  else if(d.prompt){assistantDraft=d.prompt;render();document.querySelector('#assistant-draft').focus();}
  else if('planner'in d)showPlanner(app,state,base,persist);
  else if('add'in d)showTask();
  else if(d.edit){const block=state.planner?.blocks.find(b=>b.id===d.edit);if(block||state.planner?.commitments.some(c=>c.id===d.edit)){showPlanner(app,state,base,persist,d.edit);return;}const task=find(d.edit);if(task)showTask(task);}
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
  else if(d.detail){if(state.planner?.blocks.some(b=>b.id===d.detail)||state.planner?.commitments.some(b=>b.id===d.detail)){showPlanner(app,state,base,persist,d.detail);return;}selected=d.detail;page='Week';render();}
  else if('closeDetail'in d){selected=null;render();}
  else if(d.start){find(d.start).status='active';persist('Session started.');}
  else if(d.done){const t=find(d.done);if(t.status==='done')return;t.minutes=Math.max(0,t.minutes-length(t));t.status=t.minutes?'partial':'done';persist('Session completed. Remaining work updated.');}
  else if(d.partial){const t=find(d.partial);app.insertAdjacentHTML('beforeend',`<dialog id="partial-dialog"><form id="partial-form"><h2>How much did you finish?</h2><input type="hidden" name="id" value="${esc(t.id)}"><label>Minutes completed<input name="completed" type="number" required min="1" max="${Math.min(length(t),t.minutes)}" value="${Math.max(1,Math.floor(Math.min(length(t),t.minutes)/2))}"></label><div class="actions"><button type="button" data-close-dialog>Cancel</button><button class="primary">Save Progress</button></div></form></dialog>`);const dialog=document.querySelector('#partial-dialog');dialog.showModal();dialog.addEventListener('close',()=>dialog.remove());}
  else if(d.miss){const t=find(d.miss);preview={id:t.id,day:Math.min(6,t.day+1)};selected=null;render();window.scrollTo(0,0);}
  else if('cancel'in d){preview=null;render();}
  else if('accept'in d){state.previous=structuredClone(state.tasks);find(preview.id).day=preview.day;preview=null;persist('Proposed move saved. You can undo it.');}
  else if('undo'in d&&state.previous){state.tasks=state.previous;state.previous=null;persist('Previous plan restored.');}
  else if('dismiss'in d){notice='';render();}
  else if(d.delete) confirmAction('Delete task?', 'This removes the task and its session from your planner.', 'confirm-delete', d.delete);
  else if(d.confirmDelete){deletePlannerTask(state,d.confirmDelete);persist('Task deleted.');}
  else if('sample'in d) confirmAction('Load sample week?', 'This replaces your current tasks. Export a backup first if you want to keep them.', 'confirm-sample');
  else if('confirmSample'in d){state=seed();persist('Sample week loaded.');}
  else if('export'in d){const url=URL.createObjectURL(new Blob([JSON.stringify({schemaVersion:1,...state},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='weekback-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
});
app.addEventListener('change',e=>{if(e.target.id==='recovery-day'){preview.day=Number(e.target.value);render();}});
app.addEventListener('input',e=>{if(e.target.id==='assistant-draft'){assistantDraft=e.target.value;resizeAssistantDraft();}});
window.addEventListener('resize',resizeAssistantDraft);
app.addEventListener('submit',e=>{
  e.preventDefault();const f=new FormData(e.target);
  if(e.target.getAttribute('id')==='task-form'){
    const title=f.get('title').trim(),course=f.get('course').trim();if(!title||!course){document.querySelector('#form-error').textContent='Enter a title and course.';return;}
    const id=f.get('id'),existing=find(id),minutes=Number(f.get('minutes'));const t={...(existing||{}),id:id||crypto.randomUUID(),title,course,minutes,sessionMinutes:Number(f.get('sessionMinutes')),day:Number(f.get('day')),time:f.get('time'),step:f.get('step').trim(),status:minutes===0?'done':existing?.status||'planned'};
    if(existing)state.tasks=state.tasks.map(item=>item.id===id?t:item);else state.tasks.push(t);persist('Task saved on this device.');
  }else if(e.target.getAttribute('id')==='partial-form'){const t=find(f.get('id'));t.minutes=Math.max(0,t.minutes-Number(f.get('completed')));t.status=t.minutes?'partial':'done';persist('Progress saved.');}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&selected){selected=null;render();}});
render();window.addEventListener('online',render);window.addEventListener('offline',render);
