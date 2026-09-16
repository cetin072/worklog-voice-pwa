function editError(code,message){
  const error=new Error(message);
  error.code=code;
  return error;
}

export function normalizeWorklogTitle(value){
  return String(value ?? "")
    .replace(/\s+/g," ")
    .trim();
}

export function validWorklogPageId(value){
  const id=String(value || "").trim();
  return /^[0-9a-f]{32}$/i.test(id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export function normalizeWorklogDueInput(dateValue,timeValue){
  const dueDate=String(dateValue ?? "").trim();
  const dueTime=String(timeValue ?? "").trim();

  if(!dueDate){
    if(dueTime) throw editError("WORKLOG_EDIT_DUE_DATE_REQUIRED","시간을 설정하려면 날짜도 입력해주세요.");
    return Object.freeze({dueDate:"",dueTime:"",dueAt:null,dueHasTime:false});
  }

  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if(!match) throw editError("WORKLOG_EDIT_DUE_DATE_INVALID","날짜 형식이 올바르지 않습니다.");
  const year=Number(match[1]);
  const month=Number(match[2]);
  const day=Number(match[3]);
  const check=new Date(Date.UTC(year,month-1,day));
  if(check.getUTCFullYear()!==year || check.getUTCMonth()!==month-1 || check.getUTCDate()!==day){
    throw editError("WORKLOG_EDIT_DUE_DATE_INVALID","존재하지 않는 날짜입니다.");
  }

  if(dueTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(dueTime)){
    throw editError("WORKLOG_EDIT_DUE_TIME_INVALID","시간 형식이 올바르지 않습니다.");
  }

  const normalizedTime=dueTime || "00:00";
  return Object.freeze({
    dueDate,
    dueTime,
    dueAt:`${dueDate}T${normalizedTime}:00+09:00`,
    dueHasTime:Boolean(dueTime)
  });
}
