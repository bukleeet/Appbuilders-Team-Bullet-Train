import {getAIStatus, warmupAI} from './ai-client.js';
import {showTaskForm} from './task-capture.js';
import { loadState, saveState, exportState, parseImportState, importState, acceptPlan, undoPlan, ValidationError } from './store.js';
import { createTask, generateId, BLOCK_STATUS } from './model.js';
import { parseInTimezone, toLocalDateAndTime } from './dates.js';
import { createDemoFixtures } from './fixtures.js';
import { repairPlan } from './scheduler.js';
import { showPlanner, sessionItems, countOpenTasks, deleteTask, todayStart, progress, canUndo, reason, titleFor } from './planner-ui.js';
import { assistantPage } from './assistant-ui.js';
import { sortedTasks, matchesTask } from './task-list.js';

let state = loadState(), page = 'Today', preview = null, selected = null, active = null;
let agendaMode = 'timeline', weekMode = window.matchMedia('(max-width: 700px)').matches ? 'list' : 'grid', offset = 0, notice = '', failed = false, warn = false;
let assistantDraft='';
let taskQuery='', taskFilter='all';
let pendingImport=null;
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
  document.title=`${preview?'Plan recovery':page} · Waypoint`;
  const previousScroll = app.querySelector('.calendar-scroll')?.scrollTop;
  const previousHorizontalScroll = app.querySelector('.calendar')?.scrollLeft;
  const focused = document.activeElement;
  const focusKey = focused instanceof HTMLElement && app.contains(focused) && focused.matches('button')
    ? Object.entries(focused.dataset).find(([key])=>['week','shift','currentWeek','page','agenda','start'].includes(key))
    : null;
  const detailFocusKey = focused instanceof HTMLElement && focused.closest('.detail-drawer')
    ? Object.entries(focused.dataset).find(([key])=>['lock','edit','planner','done','partial','miss'].includes(key))
    : null;
  const nav={Today:'calendar',Week:'columns-3',Tasks:'circle-check',Assistant:'notebook',Settings:'settings-2'};
 app.innerHTML=`<a class="skip-link" href="#main-content">Skip to content</a><aside class="sidebar"><div class="brand"><img class="brand-logo" src="/public/waypoint-logo.png" alt=""><span>Waypoint<small>Your study, mapped out.</small></span></div><div class="sidebar-label">WORKSPACE</div><nav aria-label="Main navigation">${Object.keys(nav).map(n=>`<button data-page="${n}" class="nav-item ${page===n?'selected':''}" ${page===n?'aria-current="page"':''}>${icon(nav[n])}<span>${n==='Assistant'?'Ask Waypoint':n}</span></button>`).join('')}</nav><div class="sidebar-footer">${icon('shield-check')}<span><strong>Private by design</strong><small>Saved in this browser</small></span></div></aside><div class="workspace"><header class="topbar"><div class="mobile-brand"><img src="/public/waypoint-logo.png" alt="">Waypoint</div>${page==='Week'&&!preview?`<div class="date-controls"><div class="week-switch"><button data-shift="-7" aria-label="Previous week">${icon('chevron-left')}</button><span>${date(offset)} – ${date(offset+6)}</span><button data-shift="7" aria-label="Next week">${icon('chevron-right')}</button></div><button class="soft" data-current-week>Current week</button></div>`:'<span class="topbar-context">YOUR STUDY SPACE <span aria-hidden="true">/</span> '+(preview?'RECOVERY':page.toUpperCase())+'</span>'}<div class="connection"><span class="pill ${failed?'error-pill':'saved'}">${failed?'Save failed':'Saved on this device'}</span><span class="pill model"><span data-ai-status>${esc(ai.label)}</span></span></div><button class="primary add-task" data-add>${icon('plus')} <span>Add task</span></button></header><main id="main-content" tabindex="-1">${notice?`<div class="notice ${failed||warn?'warning':''}" role="status">${esc(notice)}<button data-dismiss aria-label="Dismiss notification">${icon('x')}</button></div>`:''}${canUndo(state)&&!preview?'<button class="undo-button" data-undo>Undo last plan change</button>':''}${preview?recovery():page==='Today'?today():page==='Week'?week():page==='Tasks'?tasks():page==='Assistant'?assistantPage(assistantDraft,ai.label):settings()}</main></div>`;
  resizeAssistantDraft();
  const calendarScroll = app.querySelector('.calendar-scroll');
  if (calendarScroll) calendarScroll.scrollTop = previousScroll ?? 8 * 120;
  const calendar = app.querySelector('.calendar');
  if (calendar) {
    calendar.tabIndex=0;
    calendar.setAttribute('role','region');
    calendar.setAttribute('aria-label','Weekly calendar. Scroll horizontally to view all seven days.');
    if (previousHorizontalScroll !== undefined) calendar.scrollLeft = previousHorizontalScroll;
    const hours=calendar.querySelector('.calendar-scroll');
    hours.tabIndex=0;
    hours.setAttribute('role','region');
    hours.setAttribute('aria-label','Hourly calendar. Scroll vertically to view later sessions.');
    if(window.matchMedia('(max-width: 1000px)').matches){
      calendar.insertAdjacentHTML('beforebegin','<p class="calendar-hint">Swipe sideways to see all seven days, or switch to List view for a simpler schedule.</p>');
    }
  }
  if (page === 'Tasks') updateTaskResults();
  const detail = app.querySelector('.detail-drawer');
  if (detail) app.append(app.querySelector('.drawer-backdrop'),detail);
  app.querySelector('.sidebar').inert=Boolean(detail);
  app.querySelector('.workspace').inert=Boolean(detail);
  document.body.classList.toggle('session-details-open',Boolean(detail));
  if (detail) {
    const previousAction = detailFocusKey && [...detail.querySelectorAll('button')].find(button=>button.dataset[detailFocusKey[0]]===detailFocusKey[1]);
    (previousAction || detail.querySelector('[data-close-detail]'))?.focus({preventScroll:true});
  }
  else if (focusKey) [...app.querySelectorAll('button')].find(button=>button.dataset[focusKey[0]]===focusKey[1])?.focus({preventScroll:true});
}
function focusPageHeading() {
  const heading = app.querySelector('#main-content h1');
  if (heading) {
    heading.tabIndex=-1;
    heading.focus({preventScroll:true});
  }
  window.scrollTo(0,0);
}
function closeSessionDetails() {
  const id=selected;
  selected=null;
  render();
  const trigger=[...app.querySelectorAll('[data-detail]')].find(button=>button.dataset.detail===id);
  const fallback=app.querySelector('#main-content h1');
  if (fallback) fallback.tabIndex=-1;
  (trigger || fallback)?.focus({preventScroll:true});
}
function restoreDialogFocus(trigger) {
  const dataset=trigger?.dataset;
  const action=dataset && Object.entries(dataset).find(([key])=>['delete','sample','partial'].includes(key));
  const replacement=action && [...app.querySelectorAll('button')].find(button=>button.dataset[action[0]]===action[1]);
  const heading=app.querySelector('#main-content h1');
  if(heading)heading.tabIndex=-1;
  (trigger?.isConnected?trigger:replacement||app.querySelector('.detail-drawer [data-close-detail]')||app.querySelector('[data-task-search]')||heading)?.focus({preventScroll:true});
}
function hero(t) {
  const elapsed = Date.parse(t.endAt) <= Date.now();
  const kicker = t.id===active?'Session in progress':elapsed?'Earlier session · update status':'Next planned session';
  return `<section class="hero ${tone(t)}"><div class="hero-main"><div class="hero-kicker"><span class="course-tag">${esc(t.course)}</span><span>${icon('clock')} ${kicker}</span></div><h2>${esc(t.title)}</h2><div class="hero-meta"><strong>${range(t)}</strong><b>${length(t)} min planned today</b><span>${esc(t.location||'')}</span></div><div class="immediate-step"><small>${icon('flag')} IMMEDIATE STEP</small><p>${esc(t.step||'Open your materials and work on the next unfinished part.')}</p>${t.reference?`<span>Reference: ${esc(t.reference)}</span>`:''}</div><p class="remaining"><strong>${icon('calendar-clock')} ${t.dueAt?`Due ${when(t.dueAt)} PHT`:'Deadline not entered'}</strong><span>${t.minutes} min total remaining · ${length(t)} min in this session</span></p></div><div class="hero-actions"><button class="primary" data-start="${esc(t.id)}">${icon('play')} ${t.id===active?'Session started':'Start Session'}</button><div class="progress-actions"><button class="soft" data-done="${esc(t.id)}">${icon('check')} Done</button><button class="soft" data-partial="${esc(t.id)}">${icon('settings-2')} Partial</button><button class="soft" data-miss="${esc(t.id)}">${icon('rotate-ccw')} Missed</button></div></div></section>`;
}
function row(t,nextId) {
return `<div class="agenda-row ${t.status==='done'?'complete':''}"><span class="timeline-marker ${t.status==='done'?'complete':t.id===nextId?'current':''}">${icon(t.kind==='fixed'?'lock-keyhole':t.status==='done'?'check':'book-open')}</span><article class="agenda-card ${tone(t)} ${t.kind==='fixed'?'fixed-card':t.id===nextId?'current-card':''}"><div class="agenda-card-top"><small>${esc(t.course)}</small><span class="status-tag">${t.id===nextId?'Current selection':status(t)}</span></div><h3>${esc(t.title)}</h3><div class="agenda-card-bottom"><span>${range(t)}${t.location?` · ${esc(t.location)}`:''}</span><button class="text-button" ${t.kind==='fixed'?'data-planner':'data-detail'}="${esc(t.id)}">${icon('square-pen')} ${t.kind==='fixed'?'Manage':'Manage session'}</button></div></article></div>`;
}
function today() {
  const agenda=sessions().filter(t=>t.day===0);
  const pending=agenda.filter(t=>t.kind!=='fixed'&&t.status==='planned');
  const next=pending.find(t=>t.id===active)||pending.find(t=>Date.parse(t.endAt)>Date.now())||pending[0];
  return `<div class="page-meta"><span class="eyebrow">YOUR STUDY DAY / ${date(0).toUpperCase()}</span><span>${icon('calendar')} ${fullDate(0)}<b>${agenda.filter(t=>t.status==='done').length} of ${agenda.length} sessions completed</b></span></div><h1>Today</h1><p class="page-description">A clear view of what needs your attention.</p>${next?hero(next):`<section class="hero empty"><div class="empty-icon">${icon('calendar-clock')}</div><div><span class="eyebrow">A FRESH START</span><h2>Your day is yours to shape.</h2><p>Capture a task, then set your available study hours in Week.</p><div class="actions"><button class="primary" data-add>${icon('plus')} Add task</button><button class="soft" data-page="Week">Open week planner</button></div></div></section>`}<div class="today-columns"><section class="panel agenda"><div class="panel-title"><div><h2>Today's agenda</h2><p>${date(0)} · ${agenda.length} scheduled sessions</p></div><div class="segmented" role="group" aria-label="Agenda view"><button data-agenda="timeline" aria-pressed="${agendaMode==='timeline'}" class="${agendaMode==='timeline'?'chosen':''}">${icon('chart-no-axes-column-increasing')} Timeline</button><button data-agenda="list" aria-pressed="${agendaMode==='list'}" class="${agendaMode==='list'?'chosen':''}">${icon('list')} List</button></div></div><div class="agenda-items ${agendaMode}">${agenda.map(t=>row(t,next?.id)).join('')||`<div class="empty-list">${icon('calendar')}<p>No sessions on the calendar today.</p><button class="text-button" data-page="Week">Make a study plan ${icon('arrow-right')}</button></div>`}</div><footer class="panel-foot">${icon('calendar-clock')} ${agenda.filter(t=>t.kind!=='fixed').reduce((s,t)=>s+length(t),0)} min of planned study<span>Times in PHT</span></footer></section><div class="right-column"><section class="panel next-action"><h2>${icon('calendar-clock')} Stay on course</h2><p>Missed a session? Preview a new plan before anything changes.</p>${state.tasks.length?`<button class="primary compact" data-recover>${icon('rotate-ccw')} Preview recovery</button>`:'<button class="soft" data-page="Week">View your week</button>'}</section><section class="panel deadlines"><div class="panel-title"><h2>Coming up</h2><span class="eyebrow">NEXT 7 DAYS</span></div>${open().filter(t=>t.dueAt&&Date.parse(t.dueAt)>=origin&&Date.parse(t.dueAt)<origin+7*86400000).sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt)).map(t=>`<button class="deadline-card ${tone(t)}" data-edit="${esc(t.id)}"><span><strong>${esc(t.course)}: ${esc(t.title)}</strong><small class="due-tag">${when(t.dueAt)}</small></span><span class="deadline-meta"><small>${scheduled(t.id)} min scheduled</small><small>${t.remainingMinutes} min remaining</small></span><span class="progress-track"><span style="width:${Math.min(100,scheduled(t.id)/Math.max(1,t.remainingMinutes)*100)}%"></span></span></button>`).join('')||'<p class="muted">Nothing due in the next seven days. New deadlines will show up here.</p>'}</section><section class="panel task-queue"><div class="panel-title"><h2>Tasks <span class="count">${open().length}</span></h2><button class="text-button" data-page="Tasks">View all ${icon('arrow-right')}</button></div><p>Small steps, a clear place to start.</p>${open().slice(0,3).map(t=>`<div class="queue-item"><div>${esc(t.title)}<small>${esc(t.course)} · ${t.remainingMinutes} min remaining</small></div><button class="soft compact" data-edit="${esc(t.id)}">${icon('pencil')} Edit</button></div>`).join('')||'<button class="soft compact" data-add>Add your first task</button>'}</section><div class="local-footer">${icon('shield-check')} Task data stays in this browser<span>No cloud sync</span></div></div></div>`;
}
function week() {
  const visible=sessions().filter(t=>t.day>=offset&&t.day<offset+7);
 return `<div class="section-heading"><div><span class="eyebrow">YOUR TIME, IN VIEW</span><h1>Week planner</h1><p class="page-description">See where your time goes and make room for what matters.</p></div><button class="primary" data-planner>${icon('calendar-clock')} Manage study plan</button></div><div class="week-summary"><div><span class="eyebrow">PLANNED STUDY</span><strong>${(visible.filter(t=>t.kind!=='fixed').reduce((s,t)=>s+length(t),0)/60).toFixed(1)} <small>hrs</small></strong></div><div><span class="eyebrow">FIXED COMMITMENTS</span><strong>${visible.filter(t=>t.kind==='fixed').length} <small>blocks</small></strong></div><div><span class="eyebrow">SCHEDULED TASKS</span><strong>${countOpenTasks(visible)}</strong></div><div class="week-tools segmented" role="group" aria-label="Week view"><button data-week="grid" aria-pressed="${weekMode==='grid'}" class="${weekMode==='grid'?'chosen':''}">${icon('columns-3')} Grid</button><button data-week="list" aria-pressed="${weekMode==='list'}" class="${weekMode==='list'?'chosen':''}">${icon('list')} List view</button></div></div>${weekMode==='list'?`<section class="panel">${Array.from({length:7},(_,i)=>`<h2 class="list-date">${fullDate(i+offset)}</h2>${visible.filter(t=>t.day===i+offset).map(t=>row(t)).join('')||'<p class="muted">No sessions scheduled.</p>'}`).join('')}</section>`:`<section class="calendar" aria-label="Weekly calendar"><div class="calendar-head"><div>${icon('clock')}</div>${Array.from({length:7},(_,i)=>`<div class="${i+offset===0?'current-day':''}"><small>${day(i+offset).toLocaleDateString('en-PH',{weekday:'short'}).toUpperCase()}</small><b>${day(i+offset).getDate()}</b><span>${visible.filter(t=>t.day===i+offset&&t.kind!=='fixed').reduce((s,t)=>s+length(t),0)} min study</span></div>`).join('')}</div><div class="calendar-scroll"><div class="calendar-body"><div class="time-gutter">${Array.from({length:24},(_,i)=>`<span style="top:${i*120}px">${String(i).padStart(2,'0')}:00</span>`).join('')}</div>${Array.from({length:7},(_,i)=>`<div class="day-column">${visible.filter(t=>t.day===i+offset).map(t=>`<button class="calendar-block ${tone(t)} ${t.kind==='fixed'?'fixed-block':''} ${t.status==='done'?'completed-block':''}" style="top:${minute(t.time)*120/60}px;height:${Math.max(30,length(t)*120/60)}px" data-detail="${esc(t.id)}" aria-label="${esc(t.title)}: ${range(t)}"><span class="block-top"><b>${esc((t.course||'').split(' · ')[0])}</b>${t.kind==='fixed'?icon('lock-keyhole'):''}</span><strong>${esc(t.title)}</strong><small>${range(t)}</small></button>`).join('')}</div>`).join('')}</div></div></section>`}<div class="calendar-legend"><span><i class="legend-square fixed-color"></i> Fixed commitments</span><span><i class="legend-square blue-color"></i> Study sessions</span><span>${icon('circle-help')} Select a block to view details</span></div>${selected&&find(selected)?drawer(find(selected)):''}`;
}
function drawer(t) {return `<div class="drawer-backdrop" data-close-detail></div><section class="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="session-detail-title"><div class="panel-title"><span class="course-tag">${esc(t.course)}</span><button class="icon-button" data-close-detail aria-label="Close details">${icon('x')}</button></div><h2 id="session-detail-title">${esc(t.title)}</h2><div class="inset"><small>SCHEDULED SESSION</small><p>${date(t.day)} · ${range(t)}</p><span>${status(t)}</span></div><h3>Next step</h3><p>${esc(t.step||'Work on the next unfinished part.')}</p><div class="drawer-actions">${t.kind==='fixed'?`<button class="primary" data-planner="${esc(t.id)}">Manage in study plan</button>`:`<button class="primary" data-edit="${esc(t.taskId)}">Edit task</button>${t.status==='planned'?`<button class="soft" data-done="${esc(t.id)}">Mark done</button><button class="soft" data-partial="${esc(t.id)}">Partial</button><button class="soft" data-miss="${esc(t.id)}">Missed · recover</button><button class="soft" data-lock="${esc(t.id)}">${t.locked?'Unlock':'Lock'} session</button>`:''}`}</div></section>`;}
function tasks() {
  const completed=state.tasks.filter(t=>t.status==='done').length;
  const remaining=state.tasks.length-completed;
  const overdue=state.tasks.filter(t=>t.status!=='done'&&t.dueAt&&Date.parse(t.dueAt)<Date.now()).length;
  const rows=sortedTasks(state.tasks).map(t=>{
    const s=nextSession(t.id), overdue=t.status!=='done'&&t.dueAt&&Date.parse(t.dueAt)<Date.now();
    return `<div class="task-table-row ${t.status==='done'?'complete':''}" data-task-id="${esc(t.id)}"><div><small>${esc(t.course||'General')}</small><h3>${esc(t.title)}</h3><span class="status-tag ${overdue?'overdue':''}">${t.status==='done'?'Completed':overdue?'Overdue':s?'Scheduled':'Not scheduled'}</span></div><span>${t.dueAt?`${overdue?'Overdue · ':'Due '}${when(t.dueAt)}`:'No deadline'}<small>${s?`${date(s.day)} · ${range(s)}`:'No upcoming session'}</small></span><span>${t.remainingMinutes} min</span><div class="actions"><button class="soft compact" data-edit="${esc(t.id)}">${icon('pencil')} Edit</button><button class="icon-button" data-delete="${esc(t.id)}" aria-label="Delete ${esc(t.title)}">${icon('x')}</button></div></div>`;
  }).join('');
  return `<span class="eyebrow">A LITTLE STRUCTURE FOR EVERYTHING AHEAD</span><h1>Tasks</h1><p class="page-description">Keep your assignments in one place and make steady progress.</p><div class="task-overview"><span><strong>${remaining}</strong> to finish</span><span><strong>${completed}</strong> completed</span>${overdue?`<span class="task-overdue-count"><strong>${overdue}</strong> overdue</span>`:''}</div><section class="panel task-table" aria-label="Your tasks">${state.tasks.length?`<div class="task-toolbar"><label for="task-search">Find a task<input type="search" id="task-search" data-task-search placeholder="Search by task or course" autocomplete="off" value="${esc(taskQuery)}"></label><div class="task-filters" role="group" aria-label="Filter tasks by status">${[['all','All'],['open','To do'],['done','Completed']].map(([value,label])=>`<button type="button" class="${taskFilter===value?'chosen':''}" data-task-filter="${value}" aria-pressed="${taskFilter===value}">${label}</button>`).join('')}</div></div><p class="task-results" data-task-results role="status"></p><div class="task-table-head"><span>TASK / COURSE</span><span>DUE · NEXT SESSION</span><span>REMAINING</span><span>ACTIONS</span></div>${rows}<div class="task-empty-filter" data-task-empty hidden><p>No tasks match these filters.</p><button class="soft" data-clear-task-filter>Clear filters</button></div>`:`<div class="empty-list">${icon('circle-check')}<p>No tasks yet. Add one to start building your week.</p><button class="primary" data-add>${icon('plus')} Add your first task</button></div>`}</section>`;
}
function updateTaskResults() {
  const rows=[...app.querySelectorAll('.task-table-row[data-task-id]')];
  if(!rows.length)return;
  let count=0;
  rows.forEach(row=>{
    const task=findTask(row.dataset.taskId);
    const visible=task && matchesTask(task,taskQuery,taskFilter);
    row.hidden=!visible;
    if(visible)count++;
  });
  const result=app.querySelector('[data-task-results]');
  if(result)result.textContent=`Showing ${count} of ${rows.length} tasks`;
  const empty=app.querySelector('[data-task-empty]');
  if(empty)empty.hidden=count!==0;
  app.querySelectorAll('[data-task-filter]').forEach(button=>{
    const chosen=button.dataset.taskFilter===taskFilter;
    button.classList.toggle('chosen',chosen);
    button.setAttribute('aria-pressed',String(chosen));
  });
}
function settings() {return `<span class="eyebrow">YOUR WORKSPACE</span><h1>Settings</h1><div class="settings-grid"><section class="panel"><h2>Local data</h2><p>Your tasks stay in this browser. Export a backup before clearing browser data.</p><div class="actions"><button class="primary" data-export>${icon('download')} Export JSON backup</button><button class="soft" data-import>Import backup</button></div><input type="file" id="import-file" accept="application/json,.json" hidden><hr><h3>Sample week</h3><p>Try the complete sample layout. Loading it replaces your tasks; export a backup first.</p><button class="soft" data-sample>Load sample week</button></section><section class="panel"><h2>Local AI</h2><span class="pill model" data-ai-status>${esc(ai.label)}</span><p data-ai-error>${esc(ai.error||'')}</p><p>Describe a task in Add Task or Ask Waypoint, then review it before saving. Manual entry always works.</p><button class="soft" data-probe>Check connection</button><hr><h3>Timezone</h3><p>Asia/Manila · Philippine Standard Time (UTC+8)</p><p class="muted">No cloud synchronization is enabled.</p></section></div>`;}
function recovery() {
  const {proposal,missed}=preview,changes=proposal.changes.filter(c=>c.type!=='keep'),kept=proposal.changes.length-changes.length;
  const label=id=>{const t=findTask(id);return t?`${esc(t.course)}: ${esc(t.title)}`:'Removed task';};
  const moved=changes.filter(c=>c.after).reduce((sum,c)=>sum+(Date.parse(c.after.endAt)-Date.parse(c.after.startAt))/60000,0);
  return `<div class="preview-notice">${icon('circle-help')}<div><b>Preview mode</b><p>Your current calendar stays unchanged until you accept.</p></div><span class="pill model">Scheduler proposal</span></div><section class="recovery-shell"><div class="recovery-heading"><span class="eyebrow">SCHEDULE RECOVERY</span><h1>Plan Recovery Preview</h1><p>${missed?`${esc(missed)} was marked missed.`:'Remaining work is fitted into your study availability.'}</p><p class="muted">Only the study availability you entered is used. Fixed commitments, locked sessions and deadlines are respected.</p></div><div class="recovery-columns"><div><h3 class="eyebrow diff-heading">PROPOSED CHANGES</h3>${changes.map(c=>`<article class="move-card">${icon(c.type==='remove'?'x':'arrow-right')}<div><h3>${label(c.taskId)}</h3>${c.before?`<p><del>${span(c.before)}</del></p>`:''}${c.after?`<strong>${span(c.after)}</strong>`:''}<p class="muted">${esc(reason(c.reason))}</p></div></article>`).join('')||'<p>No changes needed. Your sessions already fit.</p>'}${proposal.unallocated.map(u=>`<p class="warning">${label(u.taskId)}: ${u.minutes} min could not be scheduled · ${esc(reason(u.reason))}</p>`).join('')}${state.availability.length?'':'<p class="warning">No study availability entered yet. Add it under Week → Manage study plan & recovery.</p>'}<div class="protected-note">${icon('lock-keyhole')} Locked and completed sessions stay unchanged.</div></div><div><div class="recovery-stats"><article class="panel"><small>UNCHANGED SESSIONS</small><strong>${kept}</strong></article><article class="panel"><small>MINUTES RESCHEDULED</small><strong>${moved}<small> min</small></strong></article></div>${proposal.warnings.length?`<div class="inset"><h3>Worth checking</h3>${proposal.warnings.map(w=>`<p>${esc(reason(w.code))}${titleFor(state,w.id)?` · ${esc(titleFor(state,w.id))}`:''}</p>`).join('')}</div>`:''}</div></div><footer class="recovery-footer"><button class="soft" data-cancel>Keep Current Plan</button><button class="primary" data-accept ${changes.length?'':'disabled'}>${icon('check')} Accept Changes & Update Week</button></footer></section>`;
}
function showTask(t=null,text='') { showTaskForm(app,state,persist,ai,t,text); }
function confirmAction(title, text, action, value = '') {
  const trigger=document.activeElement;
  app.insertAdjacentHTML('beforeend', `<dialog id="confirmation-dialog" aria-labelledby="confirmation-title" aria-describedby="confirmation-description"><div class="confirm-symbol" aria-hidden="true">${icon('triangle-alert')}</div><h2 id="confirmation-title">${esc(title)}</h2><p id="confirmation-description">${esc(text)}</p><div class="actions"><button class="soft" data-close-dialog>Keep current data</button><button class="danger" data-${action}="${esc(value)}">${action==='confirm-delete'?'Delete task':action==='confirm-import'?'Import and replace':'Load sample week'}</button></div></dialog>`);
  const dialog = app.querySelector('#confirmation-dialog');
  dialog.confirmTrigger=trigger;
  dialog.showModal();
  dialog.querySelector('[data-close-dialog]').focus();
  dialog.addEventListener('close', () => {
    if(action==='confirm-import')pendingImport=null;
    dialog.remove();
    if(dialog.returnValue!=='confirmed')restoreDialogFocus(trigger);
  });
}
function finishConfirmation() {
  const dialog=app.querySelector('#confirmation-dialog');
  if(!dialog)return null;
  const trigger=dialog.confirmTrigger;
  dialog.close('confirmed');
  dialog.remove();
  return trigger;
}
app.addEventListener('click',e=>{
  if(e.target.classList.contains('drawer-backdrop')){closeSessionDetails();return;}
  const button=e.target.closest('button');if(!button)return;const d=button.dataset;
  if(d.page){page=d.page;preview=null;selected=null;render();focusPageHeading();if(page==='Settings'||page==='Assistant'){probe();if(page==='Assistant')warmupAI().catch(()=>{});}}
  else if(d.shift){offset+=Number(d.shift);page='Week';preview=null;render();}
  else if('currentWeek'in d){offset=0;page='Week';preview=null;render();}
  else if('today'in d){offset=0;page='Today';preview=null;selected=null;render();focusPageHeading();}
  else if(d.prompt){assistantDraft=d.prompt;render();document.querySelector('#assistant-draft').focus();}
  else if('planner'in d){if(selected){selected=null;render();}showPlanner(app,state,persist,d.planner||null);}
  else if('probe'in d)probe();
  else if('capture'in d)showTask(null,assistantDraft);
  else if('add'in d){warmupAI().catch(()=>{});showTask();}
  else if(d.edit){const task=findTask(d.edit);if(task)showTask(task);}
  else if('closeDialog'in d)button.closest('dialog')?.close();
  else if(d.taskFilter){taskFilter=d.taskFilter;updateTaskResults();}
  else if('clearTaskFilter'in d){taskQuery='';taskFilter='all';const search=app.querySelector('[data-task-search]');if(search){search.value='';search.focus();}updateTaskResults();}
  else if(d.agenda){
    if(agendaMode===d.agenda)return;
    const items=app.querySelector('.agenda-items');
    const before=new Map([...items.querySelectorAll('.agenda-card')].map(card=>[card,card.getBoundingClientRect()]));
    agendaMode=d.agenda;
    items.classList.toggle('timeline',agendaMode==='timeline');
    items.classList.toggle('list',agendaMode==='list');
    app.querySelectorAll('[data-agenda]').forEach(button=>{const chosen=button.dataset.agenda===agendaMode;button.classList.toggle('chosen',chosen);button.setAttribute('aria-pressed',String(chosen));});
    if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      before.forEach((rect,card)=>{const after=card.getBoundingClientRect();card.animate([{transform:`translate(${rect.left-after.left}px,${rect.top-after.top}px) scaleX(${rect.width/after.width})`},{transform:'none'}],{duration:220,easing:'cubic-bezier(.2,.7,.2,1)'});});
    }
  }
  else if(d.week){weekMode=d.week;render();}
  else if(d.detail){if(find(d.detail)?.kind==='fixed'){showPlanner(app,state,persist,d.detail);return;}selected=d.detail;page='Week';render();}
  else if('closeDetail'in d){closeSessionDetails();}
  else if(d.start){active=d.start;notice='Session started.';render();}
  else if(d.done){progress(state,{blockId:d.done,status:BLOCK_STATUS.COMPLETED});if(active===d.done)active=null;selected=null;persist('Session completed. Remaining work updated.');}
  else if(d.partial){const t=find(d.partial),b=state.blocks.find(b=>b.id===t.id),maximum=Math.min(length(t),b.completedMinutes+findTask(t.taskId).remainingMinutes);if(maximum<=b.completedMinutes)return;const trigger=button;app.insertAdjacentHTML('beforeend',`<dialog id="partial-dialog" aria-labelledby="partial-title"><form id="partial-form"><h2 id="partial-title">How much did you finish?</h2><input type="hidden" name="id" value="${esc(t.id)}"><label>Minutes completed in this session<input name="completed" type="number" required min="${b.completedMinutes+1}" max="${maximum}" value="${Math.min(maximum,Math.max(b.completedMinutes+1,Math.floor(maximum/2)))}"></label><div class="actions"><button type="button" class="soft" data-close-dialog>Cancel</button><button class="primary">Save progress</button></div></form></dialog>`);const dialog=app.querySelector('#partial-dialog');dialog.showModal();dialog.querySelector('[name=completed]').focus();dialog.addEventListener('close',()=>{dialog.remove();restoreDialogFocus(trigger);});}
  else if(d.miss){const t=find(d.miss);progress(state,{blockId:t.id,status:BLOCK_STATUS.MISSED});if(active===t.id)active=null;const saved=persist('',false);preview={proposal:repairPlan(state,{now:new Date().toISOString()}),missed:t.title};selected=null;if(!saved.ok)notice=saved.message;render();window.scrollTo(0,0);}
  else if('recover'in d){preview={proposal:repairPlan(state,{now:new Date().toISOString()})};selected=null;render();window.scrollTo(0,0);}
  else if('cancel'in d){preview=null;render();}
  else if('accept'in d&&preview){acceptPlan(state,preview.proposal,'recovery');preview=null;persist('Recovery plan saved. You can undo it.');}
  else if('undo'in d&&canUndo(state)){undoPlan(state);persist('Previous plan restored.');}
  else if(d.lock){const b=state.blocks.find(b=>b.id===d.lock);b.locked=!b.locked;persist(b.locked?'Session locked. Recovery will not move it.':'Session unlocked.');}
  else if('dismiss'in d){notice='';render();}
  else if(d.delete) confirmAction('Delete task?', 'This removes the task and its sessions from your planner.', 'confirm-delete', d.delete);
  else if(d.confirmDelete){const trigger=finishConfirmation();deleteTask(state,d.confirmDelete);persist('Task deleted.');restoreDialogFocus(trigger);}
  else if('sample'in d) confirmAction('Load sample week?', 'This replaces your current tasks. Export a backup first if you want to keep them.', 'confirm-sample');
  else if('confirmSample'in d){const trigger=finishConfirmation();state=createDemoFixtures();preview=null;selected=null;taskQuery='';taskFilter='all';persist('Sample week loaded.');restoreDialogFocus(trigger);}
  else if('confirmImport'in d){
    const backup=pendingImport,trigger=finishConfirmation();pendingImport=null;
    try {
      if(!backup)throw new ValidationError('No backup selected.');
      state=importState(backup).state;
      preview=null;selected=null;active=null;taskQuery='';taskFilter='all';failed=false;warn=false;notice='Backup imported and saved on this device.';
    }catch(err){warn=true;notice=`Import failed. Your current workspace was kept. ${err.message}${err.errors?.length?` (${err.errors[0]})`:''}`;}
    render();restoreDialogFocus(trigger);
  }
  else if('import'in d){const input=document.querySelector('#import-file');if(input){input.value='';input.click();}}
  else if('export'in d){try{const url=URL.createObjectURL(new Blob([exportState(state)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='waypoint-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(err){notice=`Export failed: ${err.errors?.[0]||err.message}`;warn=true;render();}}
});
app.addEventListener('change',async e=>{
  if(e.target.id!=='import-file'||!e.target.files[0])return;
  try {
    const backup=await e.target.files[0].text();
    const incoming=parseImportState(backup);
    pendingImport=backup;
    confirmAction('Replace your workspace?',`This backup contains ${incoming.tasks.length} tasks and ${incoming.blocks.length} study sessions. Importing it replaces your current ${state.tasks.length} tasks and calendar. Export a backup first if you want to keep them.`, 'confirm-import');
  }catch(err){pendingImport=null;warn=true;notice=`${err.message}${err.errors?.length?` (${err.errors[0]})`:''}`;render();}
});
app.addEventListener('input',e=>{if(e.target.matches('[data-task-search]')){taskQuery=e.target.value;updateTaskResults();}else if(e.target.id==='assistant-draft'){assistantDraft=e.target.value;resizeAssistantDraft();}});
window.addEventListener('resize',resizeAssistantDraft);
app.addEventListener('submit',e=>{
  e.preventDefault();const f=new FormData(e.target);
  if(e.target.getAttribute('id')==='partial-form'){progress(state,{blockId:f.get('id'),completedMinutes:Number(f.get('completed')),status:BLOCK_STATUS.PARTIALLY_COMPLETED});const dialog=app.querySelector('#partial-dialog');dialog?.close();dialog?.remove();persist('Progress saved.');}
});
document.addEventListener('keydown',e=>{
  if(!selected || document.querySelector('dialog[open]'))return;
  if(e.key==='Escape'){e.preventDefault();closeSessionDetails();return;}
  if(e.key!=='Tab')return;
  const drawer=app.querySelector('.detail-drawer');
  if(!drawer)return;
  const buttons=[...drawer.querySelectorAll('button:not(:disabled)')];
  if(!buttons.length)return;
  const first=buttons[0],last=buttons.at(-1);
  if(e.shiftKey && (document.activeElement===first || !drawer.contains(document.activeElement))){e.preventDefault();last.focus();}
  else if(!e.shiftKey && (document.activeElement===last || !drawer.contains(document.activeElement))){e.preventDefault();first.focus();}
});
render();probe();window.addEventListener('online',probe);window.addEventListener('offline',probe);
