import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveAirCoordinates,summarizeAirCoordinates} from '../dist/spc-air.mjs';

test('derives Catch and directed Flick endpoints with float32 values and curve modes',()=>{
 const pairs=[[3,2],[7,2],[1,2],[3,2]];
 const catchValue=deriveAirCoordinates([0,1,0x504,8|16|64|128],pairs);
 assert.equal(catchValue.type,'catch');assert.equal(catchValue.direction,null);assert.equal(catchValue.status,'resolved');
 assert.deepEqual(catchValue.curveModes,{left:1,right:1});assert.equal(catchValue.start.center,Math.fround(Math.fround(3)/Math.fround(2)));
 assert.equal(catchValue.start.x,null);assert.equal(catchValue.start.left,Math.fround(catchValue.start.center-Math.fround(catchValue.start.width/2)));
 const flick=deriveAirCoordinates([0,1,0x404,0x400],pairs);assert.equal(flick.type,'flick');assert.equal(flick.direction,'right');assert.equal(flick.start.x,flick.start.right);
 assert.equal(deriveAirCoordinates([0,1,1,0],pairs),null);
 const nativeA=deriveAirCoordinates([0,1,0x504,0],[[5,6],[8,12],[1,3],[6,12]]);
 assert.equal(nativeA.start.left,0.6666666269302368);
 const nativeB=deriveAirCoordinates([0,1,0x404,0x400],[[5,6],[8,12],[1,3],[6,12]]);
 assert.equal(nativeB.end.left,0.4166666865348816);assert.equal(nativeB.end.right,0.9166666865348816);
});

test('marks unsupported, denominator, nonfinite and negative geometry unresolved with priority',()=>{
 assert.equal(deriveAirCoordinates([0,1,0x604,0],[[1,1],[2,1],[1,1],[1,1]]).reason,'subtype-unsupported');
 assert.equal(deriveAirCoordinates([0,1,0x504,0],[[1,0],[2,1],[1,1],[1,1]]).reason,'zero-denominator');
 assert.equal(deriveAirCoordinates([0,1,0x504,0],[[1,1],[2,1],[1,1],[1,0]]).reason,'zero-denominator');
 assert.equal(deriveAirCoordinates([0,1,0x504,0],[[1,1],[2,1],[-1,1],[1,1]]).reason,'negative-width');
 assert.equal(deriveAirCoordinates([0,1,0x504,0],[[1e40,1],[2,1],[1,1],[1,1]]).reason,'nonfinite-geometry');
 const summary=summarizeAirCoordinates([deriveAirCoordinates([0,1,0x504,0],[[1,1],[2,1],[1,1],[1,1]]),deriveAirCoordinates([0,1,0x404,0],[[1,1],[2,1],[1,1],[1,1]])]);
 assert.deepEqual(summary,{count:2,resolvedCount:2,unresolvedCount:0,catchCount:1,flickCount:1,unknownSubtypeCount:0,flickDirectionCounts:{left:1,right:0},frame:'native-normalized',precision:'float32-operations'});
});
