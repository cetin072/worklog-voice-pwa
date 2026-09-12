const SEOUL_TZ="Asia/Seoul";

function normalize(value){
  return String(value ?? "").replace(/\s+/g," ").trim();
}

function seoulParts(input=new Date()){
  const date=input instanceof Date ? input : new Date(input);
  if(Number.isNaN(date.getTime())) return null;
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:SEOUL_TZ,
    year:"numeric",month:"2-digit",day:"2-digit",weekday:"short"
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

function nextWeekdayDate(base,target,weekOffset){
  const current=currentWeekday(base);
  const mondayOffset=(current+6)%7;
  const targetFromMonday=(target+6)%7;
  const delta=-mondayOffset+(weekOffset*7)+targetFromMonday;
  return addDays(base,delta);
}

function parseDate(source,base){
  let match;

  match=source.match(/\b(20\d{2})년\s*(1[0-2]|0?[1-9])월\s*(3[01]|[12]?\d)일\b/);
  if(match){
    const date=ymdDate(Number(match[1]),Number(match[2]),Number(match[3]));
    if(date) return {key:formatYmd(date),raw:match[0]};
  }

  match=source.match(/\b(1[0-2]|0?[1-9])월\s*(3[01]|[12]?\d)일\b/);
  if(match){
    const month=Number(match[1]);
    const day=Number(match[2]);
    let year=base.year;
    let date=ymdDate(year,month,day);
    const baseDate=ymdDate(base.year,base.month,base.day);
    if(date && date<baseDate){
      const next=ymdDate(year+1,month,day);
      if(next) date=next;
    }
    if(date) return {key:formatYmd(date),raw:match[0]};
  }

  match=source.match(/(?:이번\s*주|이번주|다음\s*주|다음주)\s*([월화수목금토일])요일/);
  if(match){
    const isNext=/다음/.test(match[0]);
    const date=nextWeekdayDate(base,weekdayIndex(match[1]),isNext?1:0);
    return {key:formatYmd(date),raw:match[0]};
  }

  const relatives=[
    {re:/\b글피\b/,days:3},
    {re:/\b모레\b/,days:2},
    {re:/\b내일\b/,days:1},
    {re:/\b오늘\b/,days:0}
  ];
  for(const item of relatives){
    match=source.match(item.re);
    if(match){
      return {key:formatYmd(addDays(base,item.days)),raw:match[0]};
    }
  }

  return null;
}

function parseTime(source){
  let match;

  match=source.match(/\b(오전|오후|아침|저녁|밤)\s*(\d{1,2})시(?:\s*(반|\d{1,2}분))?/);
  if(match){
    let hour=Number(match[2]);
    if(hour<1 || hour>12) return null;
    const meridiem=match[1];
    if(meridiem==="오후" || meridiem==="저녁" || meridiem==="밤"){
      if(hour!==12) hour+=12;
    }else if(hour===12){
      hour=0;
    }
    const minute=match[3]==="반" ? 30 : Number(String(match[3] || "0").replace("분",""));
    if(minute<0 || minute>59) return null;
    return {hour,minute,raw:match[0]};
  }

  match=source.match(/\b(1\d|2[0-3])시(?:\s*(반|\d{1,2}분))?/);
  if(match){
    const hour=Number(match[1]);
    const minute=match[2]==="반" ? 30 : Number(String(match[2] || "0").replace("분",""));
    if(minute<0 || minute>59) return null;
    return {hour,minute,raw:match[0]};
  }

  if(/\b정오\b/.test(source)) return {hour:12,minute:0,raw:"정오"};
  if(/\b자정\b/.test(source)) return {hour:0,minute:0,raw:"자정"};
  return null;
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

export function extractScheduleFromText(value,recordedAt=new Date()){
  const source=normalize(value);
  if(!source) return {text:"",dueStart:"",dateKey:"",hasTime:false,matched:false};
  const base=seoulParts(recordedAt);
  if(!base) return {text:source,dueStart:"",dateKey:"",hasTime:false,matched:false};

  const datePart=parseDate(source,base);
  const timePart=parseTime(source);
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
