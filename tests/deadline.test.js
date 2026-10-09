import test from 'node:test';
import assert from 'node:assert/strict';
import {explicitManilaDeadline} from '../server/deadline.js';
import {toLocalDateAndTime} from '../src/dates.js';
const context={currentDate:'2026-10-10T00:00:00Z',timezone:'Asia/Manila'};
test('date-only deadline converts Manila end of day to UTC without advancing display date',()=>{
  const result=explicitManilaDeadline('MATH homework due October 13, takes 60 minutes.',context);
  assert.equal(result,'2026-10-13T15:59:00.000Z');
  assert.deepEqual(toLocalDateAndTime(result),{date:'2026-10-13',time:'23:59'});
});
test('explicit deadline time and year are respected',()=>{
  assert.equal(explicitManilaDeadline('report due October 13 2026 at 5 PM',context),'2026-10-13T09:00:00.000Z');
  assert.equal(explicitManilaDeadline('due October 13 at 12 AM',context),'2026-10-12T16:00:00.000Z');
});
test('invalid dates and unsupported phrases are not silently converted',()=>{
  assert.equal(explicitManilaDeadline('due February 30',context),null);
  assert.equal(explicitManilaDeadline('due Friday',context),null);
  assert.equal(explicitManilaDeadline('Read October 13 chapter',context),null);
});
