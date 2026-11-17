import { createHash } from 'node:crypto';
import { createDurableStorage } from '../../mobile/src/platform/durable-storage.ts';
export const NOW = Date.parse('2030-01-01T00:00:00Z');
export const STATE_KEY = 'worklog.mobile.schedule-notifications.v3';
export const scope = (owner='A', project='https://project-a.invalid') => JSON.stringify([project,'worklog',owner]);
export const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
export async function startupFixture(createService, {count=12, accountScope, latency=0}={}) {
 const disk=new Map(), os=new Map(), counts={read:0,write:0,list:0,cancel:0,schedule:0};
 let fail=()=>{}, generation=0;
 const tick=async kind=>{counts[kind]++;if(latency)await delay(latency);fail(kind);};
 const storage=createDurableStorage({store:{
  async getItem(key){await tick('read');return disk.get(key)??null;},
  async setItem(key,value){await tick('write');disk.set(key,value);fail('wrote');},
  async removeItem(key){await tick('write');disk.delete(key);},
 },newGenerationId:()=>String(++generation).padStart(32,'0'),digest:async value=>createHash('sha256').update(value).digest('hex')});
 const driver={
  async list(){await tick('list');return structuredClone([...os.values()]);},
  async cancel(id){await tick('cancel');os.delete(id);fail('cancelled');},
  async permission(){return true;},
  async schedule(item,sid){await tick('schedule');put(item,sid);return item.identifier;},
 };
 function put(item,sid){os.set(item.identifier,{identifier:item.identifier,content:{body:item.title,data:{owner:'worklog.schedule-reminder.v3',target:'schedule',scheduleId:sid,offsetMinutes:item.offsetMinutes,triggerAt:item.triggerAt}}});}
 const state={version:3,reminders:{},intents:{},legacyCleanup:{},...(accountScope?{accountScope}:{})};
 for(let i=0;i<count;i++){
  const sid='synthetic-'+i, item={identifier:'worklog.reminder.v3.synthetic-'+i,title:'Synthetic event',offsetMinutes:[5,30,1440][i%3],triggerAt:'2030-01-03T00:00:00.000Z'};
  state.reminders[sid]={[item.offsetMinutes]:item};put(item,sid);
 }
 await storage.updateItem(STATE_KEY,()=>JSON.stringify(state));
 const service=()=>createService({storage,driver,newId:()=>`test-${++generation}`,now:()=>NOW});
 Object.keys(counts).forEach(k=>counts[k]=0);
 return {service:service(),restart:service,storage,driver,os,counts,fail(fn){fail=fn;}};
}
