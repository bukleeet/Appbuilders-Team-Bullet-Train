import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEstimate} from '../src/task-draft-ui.js';
test('backend null effort with an unconfirmed warning is offered separately',()=>{
  assert.deepEqual(reviewEstimate({estimatedMinutes:null,warnings:['Model estimated 120 minutes (unconfirmed)']}),{confirmed:null,suggested:120});
});
test('explicit effort is confirmed and missing effort remains blank',()=>{
  assert.deepEqual(reviewEstimate({estimatedMinutes:90,warnings:[]}),{confirmed:90,suggested:null});
  assert.deepEqual(reviewEstimate({estimatedMinutes:null,warnings:[]}),{confirmed:null,suggested:null});
});
