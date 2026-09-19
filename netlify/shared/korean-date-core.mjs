export const SEOUL_TIMEZONE = "Asia/Seoul";

function normalize(value){
  return String(value ?? "").replace(/\s+/g," ").trim();
}

export function seoulDateParts(input=new Date()){
  const date=input instanceof Date ? input : new Date(input);
  if(Number.isNaN(date.getTime())) return null;
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:SEOUL_TIMEZONE,
    year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(date);
  const get=type=>parts.find(part=>part.type===type)?.value || "";
  return {year:Number(get("year")),month:Number(get("month")),day:Number(get("day"))};
}

export function ymdDate(year,month,day){
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) return null;
  return date;
}

export function formatYmd(date){
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`;
}

export function addDays(base,days){
  const date=ymdDate(base.year,base.month,base.day);
  if(!date) return null;
  date.setUTCDate(date.getUTCDate()+days);
  return date;
}

function weekdayIndex(label){
  return {일:0,월:1,화:2,수:3,목:4,금:5,토:6}[label];
}

function currentWeekday(base){
  return ymdDate(base.year,base.month,base.day)?.getUTCDay();
}

function weekDate(base,target,weekOffset){
  const current=currentWeekday(base);
  if(current===undefined) return null;
  const mondayOffset=(current+6)%7;
  const targetFromMonday=(target+6)%7;
  const delta=-mondayOffset+(weekOffset*7)+targetFromMonday;
  return addDays(base,delta);
}

function previousWeekday(base,target){
  const current=currentWeekday(base);
  if(current===undefined) return null;
  let delta=(current-target+7)%7;
  if(delta===0) delta=7;
  return addDays(base,-delta);
}

function nextWeekday(base,target){
  const current=currentWeekday(base);
  if(current===undefined) return null;
  const delta=(target-current+7)%7;
  return addDays(base,delta);
}

function dateResult(match,date){
  if(!match || !date) return null;
  return {key:formatYmd(date),raw:match[0],index:match.index};
}

function explicitDate(source,base,{rollPastMonthDayForward=false}={}){
  let match=source.match(/(20\d{2})년\s*(1[0-2]|0?[1-9])월\s*(3[01]|[12]?\d)일/);
  if(match){
    return dateResult(match,ymdDate(Number(match[1]),Number(match[2]),Number(match[3])));
  }

  match=source.match(/(1[0-2]|0?[1-9])월\s*(3[01]|[12]?\d)일/);
  if(!match) return null;

  const month=Number(match[1]);
  const day=Number(match[2]);
  let date=ymdDate(base.year,month,day);
  if(!date) return null;
  if(rollPastMonthDayForward){
    const baseDate=ymdDate(base.year,base.month,base.day);
    if(baseDate && date<baseDate){
      const next=ymdDate(base.year+1,month,day);
      if(next) date=next;
    }
  }
  return dateResult(match,date);
}

function weekExpression(source,base,{journal=false}={}){
  let match;
  if(journal){
    match=source.match(/(?:지난\s*주|지난주)\s*([월화수목금토일])요일/);
    if(match) return dateResult(match,weekDate(base,weekdayIndex(match[1]),-1));

    match=source.match(/지난\s*([월화수목금토일])요일/);
    if(match) return dateResult(match,previousWeekday(base,weekdayIndex(match[1])));
  }

  match=source.match(/(?:이번\s*주|이번주|다음\s*주|다음주)\s*([월화수목금토일])요일/);
  if(match){
    const isNext=/다음/.test(match[0]);
    return dateResult(match,weekDate(base,weekdayIndex(match[1]),isNext?1:0));
  }

  if(!journal){
    match=source.match(/([월화수목금토일])요일/);
    if(match){
      const prefix=source.slice(Math.max(0,(match.index || 0)-8),match.index || 0);
      if(!/(?:지난\s*주|지난주|지난\s*)$/.test(prefix)){
        return dateResult(match,nextWeekday(base,weekdayIndex(match[1])));
      }
    }
  }
  return null;
}

function relativeExpression(source,base,{journal=false}={}){
  const relatives=journal
    ? [
      {re:/그저께|그제/,days:-2},
      {re:/어제/,days:-1},
      {re:/오늘/,days:0},
      {re:/내일/,days:1},
      {re:/모레/,days:2},
      {re:/글피/,days:3}
    ]
    : [
      {re:/글피/,days:3},
      {re:/모레/,days:2},
      {re:/내일/,days:1},
      {re:/오늘/,days:0}
    ];

  for(const item of relatives){
    const match=source.match(item.re);
    if(match) return dateResult(match,addDays(base,item.days));
  }
  return null;
}

export function parseKoreanDateExpression(value,baseInput=new Date(),options={}){
  const source=normalize(value);
  const base=baseInput && typeof baseInput==="object" && "year" in baseInput
    ? baseInput
    : seoulDateParts(baseInput);
  if(!source || !base) return null;

  const policy=options.policy==="journal" ? "journal" : "schedule";
  return explicitDate(source,base,{rollPastMonthDayForward:policy==="schedule"})
    || weekExpression(source,base,{journal:policy==="journal"})
    || relativeExpression(source,base,{journal:policy==="journal"})
    || null;
}

export function parseKoreanTimeExpression(value){
  const source=normalize(value);
  let match=source.match(/(오전|오후|아침|저녁|밤)\s*(\d{1,2})시(?:\s*(반|\d{1,2}분))?/);
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

const SCHEDULE_DATE_SIGNAL_RE=/(?:20\d{2}년\s*(?:1[0-2]|0?[1-9])월\s*(?:3[01]|[12]?\d)일|(?:1[0-2]|0?[1-9])월\s*(?:3[01]|[12]?\d)일|(?:이번\s*주|이번주|다음\s*주|다음주)\s*[월화수목금토일]요일|[월화수목금토일]요일|글피|모레|내일|오늘)/g;
const JOURNAL_DATE_SIGNAL_RE=/(?:20\d{2}년\s*(?:1[0-2]|0?[1-9])월\s*(?:3[01]|[12]?\d)일|(?:1[0-2]|0?[1-9])월\s*(?:3[01]|[12]?\d)일|(?:지난\s*주|지난주|이번\s*주|이번주|다음\s*주|다음주)\s*[월화수목금토일]요일|지난\s*[월화수목금토일]요일|그저께|그제|어제|오늘|내일|모레|글피)/g;
const TIME_SIGNAL_RE=/(?:(?:오전|오후|아침|저녁|밤)\s*\d{1,2}시(?:\s*(?:반|\d{1,2}분))?|(?:1\d|2[0-3])시(?:\s*(?:반|\d{1,2}분))?|정오|자정)/g;

export function countKoreanDateSignals(value,{policy="schedule"}={}){
  const source=normalize(value);
  const matches=source.match(policy==="journal" ? JOURNAL_DATE_SIGNAL_RE : SCHEDULE_DATE_SIGNAL_RE) || [];
  return matches.length;
}

export function countKoreanTimeSignals(value){
  const source=normalize(value);
  return (source.match(TIME_SIGNAL_RE) || []).length;
}

export function extractJournalDateFromText(value,recordedAt=new Date()){
  const source=normalize(value);
  if(!source) return {dateKey:"",matched:false,raw:"",ambiguous:false};
  const base=seoulDateParts(recordedAt);
  if(!base) return {dateKey:"",matched:false,raw:"",ambiguous:false};

  const datePart=parseKoreanDateExpression(source,base,{policy:"journal"});
  const signalCount=countKoreanDateSignals(source,{policy:"journal"});
  const ambiguous=signalCount>1 || signalCount>Number(Boolean(datePart));
  if(ambiguous) return {dateKey:"",matched:false,raw:"",ambiguous:true};
  if(!datePart){
    const today=addDays(base,0);
    return {dateKey:today ? formatYmd(today) : "",matched:false,raw:"",ambiguous:false};
  }
  return {dateKey:datePart.key,matched:true,raw:datePart.raw,ambiguous:false};
}
