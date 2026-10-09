import {interpretTask, warmupAI} from './ai-client.js';
import {toLocalDateAndTime,parseInTimezone} from './dates.js';
import {createTask} from './model.js';
import {saveTaskEdit} from './ui-mutations.js';
import {reviewEstimate} from './task-draft-ui.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/**
 * Instant heuristic parser for 0ms form pre-fill while local AI processes in background.
 * Extracts title, course, duration, and Manila deadlines.
 */
export function fastParseTaskText(text) {
  if (!text || typeof text !== 'string') return {};
  const t = text.trim();
  if (!t) return {};
  const result = {};

  // 1. Course code detection: e.g. "MATH 54", "CS 101", "BIO 3A", "HIST 1"
  const courseMatch = t.match(/\b([A-Z]{2,}\s*\d+[a-zA-Z]?)\b/);
  if (courseMatch) {
    result.course = courseMatch[1].toUpperCase();
  }

  // 2. Explicit duration detection
  let cleanForDur = t.replace(/\b[A-Z]{2,}\s*\d+[a-zA-Z]\b/g, ' ').toLowerCase();
  cleanForDur = cleanForDur.replace(/\b(?:due\s+in|due\s+within|in|within)\s+\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/gi, ' ');

  if (/\b(?:half\s+an\s+hour|half\s+hour)\b/i.test(cleanForDur)) {
    result.minutes = 30;
  } else if (/\b(?:quarter\s+of\s+an\s+hour|quarter\s+hour)\b/i.test(cleanForDur)) {
    result.minutes = 15;
  } else {
    const hrMin = cleanForDur.match(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:and\s*)?(\d+)\s*(?:mins?|minutes?|m)\b/i);
    if (hrMin) {
      result.minutes = Math.round(parseFloat(hrMin[1]) * 60 + parseInt(hrMin[2], 10));
    } else {
      const hrMatch = cleanForDur.match(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i) || cleanForDur.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*h\b/i);
      if (hrMatch) {
        result.minutes = Math.round(parseFloat(hrMatch[1]) * 60);
      } else {
        const minMatch = cleanForDur.match(/\b(\d+)\s*(?:mins?|minutes?)\b/i) || cleanForDur.match(/(?:^|[^a-z0-9])(\d+)\s*m\b/i);
        if (minMatch) {
          result.minutes = parseInt(minMatch[1], 10);
        }
      }
    }
  }

  // 3. Deadline heuristic for relative days (Friday, tomorrow, Monday, etc.)
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayMatch = t.match(/\b(?:due|by|on|before)?\s*(this|next)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i);
  if (dayMatch) {
    const targetWord = dayMatch[2].toLowerCase();
    const now = new Date();
    const manilaDayStr = toLocalDateAndTime(now, 'Asia/Manila').date;
    const baseDate = new Date(`${manilaDayStr}T12:00:00+08:00`);

    let targetDate = null;
    if (targetWord === 'today') {
      targetDate = baseDate;
    } else if (targetWord === 'tomorrow') {
      targetDate = new Date(baseDate.getTime() + 86400000);
    } else {
      const targetIdx = dayNames.indexOf(targetWord);
      const currentWeekday = baseDate.getDay();
      let diffDays = targetIdx - currentWeekday;
      if (diffDays <= 0) diffDays += 7;
      targetDate = new Date(baseDate.getTime() + diffDays * 86400000);
    }

    if (targetDate) {
      const local = toLocalDateAndTime(targetDate, 'Asia/Manila');
      result.dueDate = local.date;

      const timeMatch = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1], 10);
        const mins = timeMatch[2] ? timeMatch[2].padStart(2, '0') : '00';
        const meridian = timeMatch[3].toLowerCase();
        if (meridian === 'pm' && hour < 12) hour += 12;
        if (meridian === 'am' && hour === 12) hour = 0;
        result.dueTime = `${String(hour).padStart(2, '0')}:${mins}`;
      } else {
        result.dueTime = '23:59';
      }
    }
  }

  // 4. Clean title
  let cleanTitle = t
    .replace(/\b(?:due|deadline|by|submit)\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)[^,.]*/gi, '')
    .replace(/\b(?:about|around|takes|for)\s+\d+(?:\.\d+)?\s*(?:hours?|hrs?|mins?|minutes?|h|m)\b/gi, '')
    .replace(/,\s*$/, '')
    .trim();
  if (cleanTitle.length > 0) {
    result.title = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
  }

  return result;
}

export function showTaskForm(app,state,persist,ai,task=null,initialText=''){
  let controller=null,steps=task?.steps||[],sourceText=task?.sourceText||'',estimate=null;
  const due=task?.dueAt?toLocalDateAndTime(task.dueAt):{date:'',time:'23:59'};
  
  // Trigger background warmup of AI model on modal launch
  warmupAI().catch(()=>{});

  app.insertAdjacentHTML('beforeend',`<dialog id="task-dialog" aria-label="${task?'Edit task':'Add task'}"><form id="task-form"><div class="dialog-head"><h2>${task?'Edit task':'Add Task'}</h2><button type="button" data-close aria-label="Close task dialog">Close</button></div><div class="dialog-body"><div class="inset capture"><h3>Describe a task</h3><p>${ai.ready?'Local AI is ready. Review the extracted details before saving.':'Local AI is unavailable. You can enter every field manually.'}</p><label>Task description<textarea id="capture-text" maxlength="4000" placeholder="MATH 54 problem set due Friday, about 2 hours">${esc(initialText)}</textarea></label><div class="actions"><button class="primary" type="button" data-interpret ${ai.ready?'':'disabled'}>Interpret</button><button class="soft" type="button" data-cancel hidden>Cancel interpretation</button></div><p id="capture-feedback" role="status"></p><button class="soft" type="button" data-estimate hidden>Use suggested estimate</button></div><label>Task title<input name="title" required maxlength="180" value="${esc(task?.title||'')}"></label><div class="form-row"><label>Course (optional)<input name="course" maxlength="60" value="${esc(task?.course||'')}"></label><label>Remaining work (minutes)<input name="minutes" type="number" min="0" max="10080" required value="${task?.remainingMinutes??60}"></label></div><div class="form-row"><label>Due date (optional)<input name="dueDate" type="date" value="${due.date}"></label><label>Due time (PHT)<input name="dueTime" type="time" value="${due.time}"></label></div><label>Next step (optional)<input name="step" maxlength="250" value="${esc(steps[0]?.title||'')}"></label><p id="form-error" role="alert"></p><p>No calendar changes occur until you save and accept a scheduling proposal.</p></div><footer class="dialog-footer"><button type="button" data-close>Cancel</button><button class="primary" data-save>Save Task</button></footer></form></dialog>`);
  
  const dialog=app.querySelector('#task-dialog'),form=dialog.querySelector('form'),feedback=dialog.querySelector('#capture-feedback');
  const field=name=>form.elements.namedItem(name);

  // Helper to instantly pre-fill detected values into manual fields
  const applyInstantParsed=(parsed)=>{
    if(parsed.title&&!field('title').value)field('title').value=parsed.title;
    if(parsed.course&&!field('course').value)field('course').value=parsed.course;
    if(parsed.minutes!=null)field('minutes').value=parsed.minutes;
    if(parsed.dueDate&&!field('dueDate').value){field('dueDate').value=parsed.dueDate;field('dueTime').value=parsed.dueTime||'23:59';}
  };

  if(!task&&initialText){
    applyInstantParsed(fastParseTaskText(initialText));
  }

  const captureArea=dialog.querySelector('#capture-text');
  captureArea.addEventListener('focus',()=>{warmupAI().catch(()=>{});});

  dialog.addEventListener('close',()=>{controller?.abort();dialog.remove();});
  dialog.addEventListener('click',async e=>{
    e.stopPropagation();
    const d=e.target.closest('button')?.dataset;
    if(!d)return;
    if('close'in d)dialog.close();
    else if('cancel'in d){controller?.abort();controller=null;feedback.textContent='Interpretation cancelled. Entered details retained.';dialog.querySelector('[data-cancel]').hidden=true;dialog.querySelector('[data-interpret]').disabled=!ai.ready;}
    else if('estimate'in d){field('minutes').value=estimate;field('minutes').classList.remove('missing-field');feedback.textContent='Suggested estimate filled. Review it before saving.';}
    else if('interpret'in d){
      const text=captureArea.value.trim();
      if(!text){feedback.textContent='Describe the assignment first.';return;}
      
      // 1. Instant 0ms client pre-fill
      const fast=fastParseTaskText(text);
      applyInstantParsed(fast);

      // 2. Background AI refinement
      controller=new AbortController();
      const request=controller;
      dialog.querySelector('[data-interpret]').disabled=true;
      dialog.querySelector('[data-cancel]').hidden=false;
      feedback.textContent='Details filled instantly. Refining steps with local AI… (you can save now or wait for steps)';
      
      try{
        const result=await interpretTask(text,{currentDate:new Date().toISOString(),timezone:'Asia/Manila'},{signal:request.signal});
        if(!dialog.isConnected||request.signal.aborted)return;
        const draft=result.draft;
        sourceText=text;
        steps=draft.steps||[];
        if(draft.title)field('title').value=draft.title;
        if(draft.course)field('course').value=draft.course;
        const deadline=draft.dueAt?toLocalDateAndTime(draft.dueAt):{date:'',time:'23:59'};
        if(deadline.date){field('dueDate').value=deadline.date;field('dueTime').value=deadline.time;}
        field('step').value=steps[0]?.title||'';
        const effort=reviewEstimate(draft);
        estimate=effort.suggested;
        if(effort.confirmed!=null)field('minutes').value=effort.confirmed;
        dialog.querySelector('[data-estimate]').hidden=estimate==null;
        dialog.querySelector('[data-estimate]').textContent=`Use suggested estimate (${estimate} min)`;
        dialog.querySelectorAll('.missing-field').forEach(el=>el.classList.remove('missing-field'));
        const mapping={title:'title',course:'course',dueAt:'dueDate',estimatedMinutes:'minutes'};
        (draft.missingFields||[]).forEach(key=>field(mapping[key]||key)?.classList.add('missing-field'));
        feedback.textContent=`Review your draft. ${result.meta.modelUsed} · ${result.meta.latencyMs==null?'Latency unavailable':(result.meta.latencyMs/1000).toFixed(1)+' s'}. Missing: ${(draft.missingFields||[]).join(', ')||'none'}. ${(draft.warnings||[]).join(' ')}`;
      }catch(error){
        if(dialog.isConnected&&!request.signal.aborted){
          feedback.textContent=({OFFLINE:'Start Ollama, then retry. Manual entry is available.',TIMEOUT:'Took too long. Manual fields are ready to save.',MALFORMED_OUTPUT:'Couldn’t read that. Manual fields are ready to save.'}[error.code]||error.message);
        }
      }finally{
        if(dialog.isConnected){
          dialog.querySelector('[data-interpret]').disabled=!ai.ready;
          dialog.querySelector('[data-cancel]').hidden=true;
        }
        controller=null;
      }
    }
  });

  form.addEventListener('submit',e=>{
    e.preventDefault();
    e.stopPropagation();
    if(controller){controller.abort();controller=null;}
    try{
      const f=new FormData(form),minutes=Number(f.get('minutes'));
      const editedStep=f.get('step').trim();
      const nextSteps=steps.map(s=>({...s}));
      if(editedStep){
        if(nextSteps.length)nextSteps[0].title=editedStep;
        else nextSteps.push({title:editedStep});
      }else if(nextSteps.length)nextSteps.shift();
      const t=createTask({
        id:task?.id,
        title:f.get('title'),
        course:f.get('course'),
        remainingMinutes:minutes,
        status:minutes===0?'done':'open',
        dueAt:f.get('dueDate')?parseInTimezone(f.get('dueDate'),f.get('dueTime')||'23:59'):null,
        steps:nextSteps,
        sourceText:sourceText||captureArea.value.trim()
      });
      saveTaskEdit(state,t);
      dialog.close();
      persist('Task saved. Open Week to preview a study plan.');
    }catch(error){
      dialog.querySelector('#form-error').textContent=error.message;
    }
  });

  dialog.showModal();
  field('title').focus();
}
