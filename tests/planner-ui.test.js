import test from 'node:test';
import assert from 'node:assert/strict';
import { plannedSessions, countOpenTasks, deletePlannerTask } from '../src/planner-ui.js';

const task={id:'essay',title:'Essay',course:'HIST',minutes:200,status:'planned'};
const block={id:'session',taskId:'essay',startAt:'2026-10-10T01:00:00Z',endAt:'2026-10-10T03:00:00Z',status:'planned'};
const fixture=()=>({tasks:[{...task}],previous:[{...task}],planner:{accepted:true,commitments:[],blocks:[{...block}],previous:{accepted:true,blocks:[{...block}]}}});

test('deletion removes sessions from live state, export and both undo snapshots',()=>{
  const state=fixture();deletePlannerTask(state,'essay');
  const reloaded=JSON.parse(JSON.stringify(state));
  assert.deepEqual(reloaded.tasks,[]);
  assert.deepEqual(reloaded.previous,[]);
  assert.deepEqual(reloaded.planner.blocks,[]);
  assert.deepEqual(reloaded.planner.previous.blocks,[]);
});

test('converted sessions retain their task identity and distinct open count',()=>{
  const state=fixture();state.planner.blocks.push({...block,id:'second'});
  const sessions=plannedSessions(state,new Date(2026,9,10,12));
  assert.equal(sessions[0].taskId,'essay');
  assert.equal(countOpenTasks(sessions),1);
  state.tasks=[];
  assert.deepEqual(plannedSessions(state,new Date(2026,9,10,12)),[]);
});

test('synthetic base wall date remains the origin outside Manila',()=>{
  const previous=process.env.TZ;
  try {
    process.env.TZ='America/Los_Angeles';
    const sessions=plannedSessions(fixture(),new Date(2026,9,10,12));
    assert.equal(sessions[0].day,0);
    assert.equal(sessions[0].time,'09:00');
  } finally {if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
