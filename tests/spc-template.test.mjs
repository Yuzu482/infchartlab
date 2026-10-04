import test from 'node:test';
import assert from 'node:assert/strict';
import {INFALSUS_NOTE_TEMPLATE} from '../dist/spc-preview.mjs';

test('In Falsus template defines all six distinct schematic examples without decoder claims',()=>{
 assert.equal(INFALSUS_NOTE_TEMPLATE.length,6);
 assert.deepEqual(INFALSUS_NOTE_TEMPLATE.map(x=>x.id),['center-note','center-long','side-note','side-long','air-catch','air-flick']);
 assert.deepEqual(INFALSUS_NOTE_TEMPLATE.map(x=>x.kind),['note','long','note','long','catch','flick']);
 assert.ok(INFALSUS_NOTE_TEMPLATE.every(x=>x.label&&x.detail));
 assert.match(INFALSUS_NOTE_TEMPLATE.find(x=>x.kind==='catch').detail,/位置仅示意/);
 assert.match(INFALSUS_NOTE_TEMPLATE.find(x=>x.kind==='flick').detail,/位置仅示意/);
});
