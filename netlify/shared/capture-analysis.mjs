import {extractScheduleFromText} from "./schedule-extract.mjs";
import {quickWorklogSchedule} from "./worklog-data-core-adapter.mjs";

const TASK_SIGNAL_RE=/(해야|해주세요|해줘|부탁|보내|제출|확인|준비|정리|연락|회신|전달|처리|작성|신청|납부|입금|결제|체크|검토)/;
const CHAT_TIME_ONLY_RE=/^(?:(?:오전|오후)\s*)?\d{1,2}:\d{2}$/;

function normalizeLines(value){
  return String(value||"").replace(/\r/g,"").split("\n").map(line=>line.replace(/\s+/g," ").trim()).filter(Boolean);
}

function uniqueLines(lines){
  const seen=new Set();return lines.filter(line=>{const key=line.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
}

function candidateId(type,index){return `${type==="ScheduleCandidate"?"schedule":"task"}-${index+1}`;}

function analysisWindows(lines){
  const windows=[];
  for(let size=3;size>=1;size--){
    for(let index=0;index+size<=lines.length;index++){
      const text=lines.slice(index,index+size).join(" ").trim();
      if(text.length>=2&&text.length<=360) windows.push(text);
    }
  }
  return windows;
}

function pushUnique(candidates,candidate){
  const key=`${candidate.type}|${candidate.dueStart||""}|${String(candidate.title||"").replace(/\s+/g," ").trim().toLowerCase()}`;
  if(candidates.some(item=>item._key===key)) return;
  candidates.push({...candidate,_key:key});
}

export function analyzeCaptureText(value,recordedAt=new Date()){
  const lines=uniqueLines(normalizeLines(value)).slice(0,80);
  const extractedText=lines.join("\n");
  const semanticLines=lines.filter(line=>!CHAT_TIME_ONLY_RE.test(line));
  const candidates=[];

  for(const segment of analysisWindows(semanticLines)){
    const schedule=extractScheduleFromText(segment,recordedAt);
    if(!schedule.matched||!schedule.hasTime) continue;
    const normalized={title:String(schedule.text||segment).trim()||segment,recordType:"other",dueAt:schedule.dueStart};
    const event=quickWorklogSchedule({transcript:segment,dueStart:schedule.dueStart},normalized);
    if(!event) continue;
    pushUnique(candidates,{type:"ScheduleCandidate",text:segment,title:event.title,dueStart:event.startsAt,requiresConfirmation:true,reason:"explicit_event_time"});
    if(candidates.length>=12) break;
  }

  for(const line of semanticLines){
    if(line.length<2||candidates.length>=12)continue;
    const schedule=extractScheduleFromText(line,recordedAt);
    if(schedule.matched){
      const coveredBySchedule=candidates.some(item=>item.type==="ScheduleCandidate"&&item.dueStart===schedule.dueStart&&item.text.includes(line));
      if(coveredBySchedule) continue;
      const normalized={title:String(schedule.text||line).trim()||line,recordType:"other",dueAt:schedule.dueStart};
      const event=quickWorklogSchedule({transcript:line,dueStart:schedule.dueStart},normalized);
      if(event){
        pushUnique(candidates,{type:"ScheduleCandidate",text:line,title:event.title,dueStart:event.startsAt,requiresConfirmation:true,reason:"explicit_event_time"});
        continue;
      }
      pushUnique(candidates,{type:"TaskCandidate",text:line,title:normalized.title,dueStart:schedule.dueStart||"",requiresConfirmation:true,reason:schedule.hasTime?"deadline_or_non_event_time":"dated_task"});
      continue;
    }
    if(TASK_SIGNAL_RE.test(line)) pushUnique(candidates,{type:"TaskCandidate",text:line,title:line,dueStart:"",requiresConfirmation:true,reason:"task_signal"});
  }

  if(!candidates.length&&extractedText){
    const text=extractedText.slice(0,1800);
    pushUnique(candidates,{type:"TaskCandidate",text,title:text.replace(/\s+/g," ").slice(0,160),dueStart:"",requiresConfirmation:true,reason:"capture_fallback"});
  }

  const bounded=candidates.slice(0,12).map(({_key,...candidate},index)=>Object.freeze({id:candidateId(candidate.type,index),...candidate}));
  return Object.freeze({type:"CaptureAnalysis",version:1,sourceType:"capture",extractedText,localOnlySource:true,candidates:Object.freeze(bounded)});
}
