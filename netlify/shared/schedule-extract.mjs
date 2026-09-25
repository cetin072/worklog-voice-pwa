import {
  countKoreanDateSignals as coreDateSignalCount,
  countKoreanTimeSignals as coreTimeSignalCount,
  parseKoreanDateExpression as coreParseDate,
  parseKoreanTimeExpression as coreParseTime,
  seoulDateParts as coreSeoulParts,
} from "./korean-date-core.mjs";

const SEOUL_TZ="Asia/Seoul";

function normalize(value){
  return String(value ?? "").replace(/\s+/g," ").trim();
}

function seoulParts(input=new Date()){
  const date=input instanceof Date ? input : new Date(input);
  if(Number.isNaN(date.getTime())) return null;
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:SEOUL_TZ,
    year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(date);
  const get=type=>parts.find(part=>part.type===type)?.value || "";
  return {year:Number(get("year")),month:Number(get("month")),day:Number(get("day"))};
}

function ymdDate(year,month,day){
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) return null;
  return date;
}

function formatYmd(date){
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`;
}

function addDays(base,days){
  const date=ymdDate(base.year,base.month,base.day);
  date.setUTCDate(date.getUTCDate()+days);
  return date;
}

function weekdayIndex(label){
  return {일:0,월:1,화:2,수:3,목:4,금:5,토:6}[label];
}

function currentWeekday(base){
  return ymdDate(base.year,base.month,base.day).getUTCDay();
}

function weekDate(base,target,weekOffset){
  const current=currentWeekday(base);
  const mondayOffset=(current+6)%7;
  const targetFromMonday=(target+6)%7;
  const delta=-mondayOffset+(weekOffset*7)+targetFromMonday;
  return addDays(base,delta);
}

function parseDate(source,base){
  let match;

  match=source.match(/(20\d{2})년\s*(1[0-2]|0?[1-9])월\s*(3[01]|[12]?\d)일/);
  if(match){
    const date=ymdDate(Number(match[1]),Number(match[2]),Number(match[3]));
    if(date) return {key:formatYmd(date),raw:match[0],index:match.index};
  }

  match=source.match(/(1[0-2]|0?[1-9])월\s*(3[01]|[12]?\d)일/);
  if(match){
    const month=Number(match[1]);
    const day=Number(match[2]);
    let date=ymdDate(base.year,month,day);
    const baseDate=ymdDate(base.year,base.month,base.day);
    if(date && date<baseDate){
      const next=ymdDate(base.year+1,month,day);
      if(next) date=next;
    }
    if(date) return {key:formatYmd(date),raw:match[0],index:match.index};
  }

  match=source.match(/(?:이번\s*주|이번주|다음\s*주|다음주)\s*([월화수목금토일])요일/);
  if(match){
    const isNext=/다음/.test(match[0]);
    const date=weekDate(base,weekdayIndex(match[1]),isNext?1:0);
    return {key:formatYmd(date),raw:match[0],index:match.index};
  }

  const relatives=[
    {re:/글피/,days:3},
    {re:/모레/,days:2},
    {re:/내일/,days:1},
    {re:/오늘/,days:0}
  ];
  for(const item of relatives){
    match=source.match(item.re);
    if(match) return {key:formatYmd(addDays(base,item.days)),raw:match[0],index:match.index};
  }

  return null;
}

function parseTime(source){
  let match;

  match=source.match(/(오전|오후|아침|저녁|밤)\s*(\d{1,2})시(?:\s*(반|\d{1,2}분))?/);
  if(match){
    let hour=Number(match[2]);
    if(hour<1 || hour>12) return null;
    const meridiem=match[1];
    if(meridiem==="밤" && hour===12){
      hour=0;
    }else if(meridiem==="오후" || meridiem==="저녁" || meridiem==="밤"){
      if(hour!==12) hour+=12;
    }else if(hour===12){
      hour=0;
    }
    const minute=match[3]==="반" ? 30 : Number(String(match[3] || "0").replace("분",""));
    if(minute<0 || minute>59) return null;
    return {hour,minute,raw:match[0],index:match.index};
  }

  match=source.match(/(1\d|2[0-3])시(?:\s*(반|\d{1,2}분))?/);
  if(match){
    const hour=Number(match[1]);
    const minute=match[2]==="반" ? 30 : Number(String(match[2] || "0").replace("분",""));
    if(minute<0 || minute>59) return null;
    return {hour,minute,raw:match[0],index:match.index};
  }

  const noonIndex=source.indexOf("정오");
  if(noonIndex>=0) return {hour:12,minute:0,raw:"정오",index:noonIndex};
  const midnightIndex=source.indexOf("자정");
  if(midnightIndex>=0) return {hour:0,minute:0,raw:"자정",index:midnightIndex};
  return null;
}

function scheduleSignalCounts(source){
  const dateMatches=source.match(/(?:20\d{2}년\s*(?:1[0-2]|0?[1-9])월\s*(?:3[01]|[12]?\d)일|(?:1[0-2]|0?[1-9])월\s*(?:3[01]|[12]?\d)일|(?:이번\s*주|이번주|다음\s*주|다음주)\s*[월화수목금토일]요일|글피|모레|내일|오늘)/g) || [];
  const timeMatches=source.match(/(?:(?:오전|오후|아침|저녁|밤)\s*\d{1,2}시(?:\s*(?:반|\d{1,2}분))?|(?:1\d|2[0-3])시(?:\s*(?:반|\d{1,2}분))?|정오|자정)/g) || [];
  return {dates:dateMatches.length,times:timeMatches.length};
}

function schedulePartsAreLinked(source,datePart,timePart){
  if(!datePart || !timePart) return true;
  const first=datePart.index<=timePart.index ? datePart : timePart;
  const second=first===datePart ? timePart : datePart;
  const gap=normalize(source.slice(first.index+first.raw.length,second.index));
  if(!gap) return true;
  if(gap.length>60) return false;
  if(/[.!?;:]/.test(gap)) return false;
  if(/(?:^|\s)(?:그리고|하지만|그러나|또|또는|혹은|하고|하며|한편)(?=\s|$)/.test(gap)) return false;
  return true;
}

function escapeRegExp(value){
  return value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
}

function removeSchedulePhrase(source,parts){
  let cleaned=source;
  for(const raw of parts.filter(Boolean).sort((a,b)=>b.length-a.length)){
    const escaped=escapeRegExp(raw);
    cleaned=cleaned.replace(new RegExp(`${escaped}(?:에|에는|까지|부터|쯤|경)?`,"g")," ");
  }
  cleaned=cleaned
    .replace(/\s+([,.!?])/g,"$1")
    .replace(/^[,.;:!?\-–—\s]+|[,.;:!?\-–—\s]+$/g,"")
    .replace(/\s+/g," ")
    .trim();
  return cleaned;
}

const RELATIVE_TIME_RE=/(\d{1,3})\s*(분|시간)\s*(?:뒤|후)(?:로)?/g;

function seoulInstant(value){
  const date=value instanceof Date ? value : new Date(value);
  if(Number.isNaN(date.getTime())) return null;
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:SEOUL_TZ,
    year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",
    hourCycle:"h23"
  }).formatToParts(date);
  const get=type=>parts.find(part=>part.type===type)?.value || "";
  return {
    dateKey:`${get("year")}-${get("month")}-${get("day")}`,
    iso:`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+09:00`
  };
}

function relativeTime(source,recordedAt){
  const matches=[...source.matchAll(RELATIVE_TIME_RE)];
  if(matches.length!==1) return {matched:false,ambiguous:matches.length>1};
  const match=matches[0];
  const amount=Number(match[1]);
  const unit=match[2];
  if(!Number.isInteger(amount) || amount<1) return {matched:false,ambiguous:true};
  const max=unit==="시간" ? 72 : 24*60;
  if(amount>max) return {matched:false,ambiguous:true};
  const base=new Date(recordedAt);
  if(Number.isNaN(base.getTime())) return {matched:false,ambiguous:true};
  const due=new Date(base.getTime()+amount*(unit==="시간" ? 3_600_000 : 60_000));
  const instant=seoulInstant(due);
  return instant
    ? {matched:true,ambiguous:false,raw:match[0],...instant}
    : {matched:false,ambiguous:true};
}

export function extractScheduleFromText(value,recordedAt=new Date()){
  const source=normalize(value);
  if(!source) return {text:"",dueStart:"",dateKey:"",hasTime:false,matched:false};
  const base=coreSeoulParts(recordedAt);
  if(!base) return {text:source,dueStart:"",dateKey:"",hasTime:false,matched:false};

  const relative=relativeTime(source,recordedAt);
  const relativeDatePart=coreParseDate(source,base,{policy:"schedule"});
  const relativeDateSignals=coreDateSignalCount(source,{policy:"schedule"});
  const relativeClockSignals=coreTimeSignalCount(source);
  if(relative.ambiguous || (relative.matched && relativeClockSignals>0)){
    return {text:source,dueStart:"",dateKey:"",hasTime:false,matched:false};
  }
  if(relative.matched){
    const redundantToday=relativeDateSignals===0
      || (relativeDateSignals===1 && relativeDatePart?.raw==="오늘" && relativeDatePart.key===relative.dateKey);
    if(!redundantToday){
      return {text:source,dueStart:"",dateKey:"",hasTime:false,matched:false};
    }
    const cleaned=removeSchedulePhrase(source,[relative.raw,relativeDatePart?.raw]);
    return {
      text:cleaned || source,
      dueStart:relative.iso,
      dateKey:relative.dateKey,
      hasTime:true,
      matched:true,
      relative:true
    };
  }

  const datePart=relativeDatePart;
  const timePart=coreParseTime(source);
  const signals={dates:relativeDateSignals,times:relativeClockSignals};
  const ambiguous=signals.dates>1 || signals.times>1 || signals.dates>Number(Boolean(datePart)) || signals.times>Number(Boolean(timePart)) || !schedulePartsAreLinked(source,datePart,timePart);
  if(ambiguous){
    return {text:source,dueStart:"",dateKey:"",hasTime:false,matched:false};
  }
  if(!datePart && !timePart){
    return {text:source,dueStart:"",dateKey:"",hasTime:false,matched:false};
  }

  const dateKey=datePart?.key || formatYmd(addDays(base,0));
  const dueStart=timePart
    ? `${dateKey}T${String(timePart.hour).padStart(2,"0")}:${String(timePart.minute).padStart(2,"0")}:00+09:00`
    : dateKey;
  const cleaned=removeSchedulePhrase(source,[datePart?.raw,timePart?.raw]);

  return {
    text:cleaned || source,
    dueStart,
    dateKey,
    hasTime:Boolean(timePart),
    matched:true
  };
}
