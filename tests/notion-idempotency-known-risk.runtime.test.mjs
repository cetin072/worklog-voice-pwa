import test from 'node:test';import assert from 'node:assert/strict';
import {createDualWriteCoordinator} from '../netlify/shared/dual-write-coordinator.mjs';
// These are failure-injection evidence of an OPEN limitation, never a claim
// that optional Notion create is exactly-once. No actual Notion API is called.
test('OPEN #133: committed Notion POST response loss can duplicate on retry; Data Core ID stays stable',async()=>{
 let creates=0;let disk={};const dc={workRecordId:'canonical-record'};
 const first=createDualWriteCoordinator({writeDataCore:async()=>dc,writeNotion:async()=>{creates++;throw Error('response lost after commit');},saveProgress:async value=>disk=structuredClone(value)});
 const failed=await first.execute({});assert.equal(failed.complete,false);
 const retry=createDualWriteCoordinator({writeDataCore:async()=>dc,writeNotion:async()=>{creates++;return {pageId:'duplicate'};}});
 const saved=await retry.execute({},disk);assert.equal(saved.dataCore.workRecordId,dc.workRecordId);assert.equal(creates,2);
});
test('OPEN #133: parallel coordinators are not a distributed lock for Notion POST',async()=>{
 let creates=0;const make=()=>createDualWriteCoordinator({writeDataCore:async()=>({workRecordId:'same-canonical-record'}),writeNotion:async()=>({pageId:'synthetic-'+(++creates)})});
 await Promise.all([make().execute({}),make().execute({})]);assert.equal(creates,2);
});
