function journalError(code,message){
  const error=new Error(message);
  error.code=code;
  return error;
}

function text(value,max=200){
  return String(value ?? "").trim().slice(0,max);
}

function validDateKey(value){
  const key=text(value,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
}

function toSchedule(row={}){
  return Object.freeze({
    scheduleId:text(row.id,200),
    title:text(row.title,200),
    startsAt:text(row.starts_at,64),
    allDay:Boolean(row.all_day),
    status:text(row.status,40),
    location:text(row.location,240),
  });
}

function toRecord(row={}){
  return Object.freeze({
    pageId:text(row.id,200),
    title:text(row.title,200),
    institution:text(row.institution,60),
    status:text(row.status,80),
    followUp:text(row.follow_up,240),
    journalDate:validDateKey(row.journal_date),
    dueAt:text(row.due_at,64),
    completedAt:text(row.completed_at,64),
    recordedAt:text(row.recorded_at,64),
  });
}

function toNote(row={}){
  return Object.freeze({
    pageId:text(row.id,200),
    title:text(row.title,200),
    institution:text(row.institution,60),
    briefingState:text(row.briefing_state,40),
    journalDate:validDateKey(row.journal_date),
    recordedAt:text(row.recorded_at,64),
    editedAt:text(row.updated_at || row.recorded_at,64),
  });
}

export function createWorklogJournalReader({client}={}){
  if(!client || typeof client.rpc!=="function") throw journalError("WORKLOG_JOURNAL_CLIENT_REQUIRED","업무일지 RPC client가 필요합니다.");

  return Object.freeze({
    async load(date){
      const target=validDateKey(date);
      if(!target) throw journalError("WORKLOG_JOURNAL_DATE_INVALID","업무일지 날짜가 올바르지 않습니다.");
      const result=await client.rpc("get_my_work_journal_day",{p_date:target});
      const row=Array.isArray(result) ? result[0] : result;
      const workspaceId=text(row?.workspace_id,200);
      const targetDate=validDateKey(row?.target_date);
      const today=validDateKey(row?.today);
      if(!workspaceId || !targetDate || !today){
        throw journalError("WORKLOG_JOURNAL_SOURCE_INVALID","업무일지 데이터를 확인하지 못했습니다.");
      }
      for(const key of ["schedules","completed","notes","open_tasks"]){
        if(!Array.isArray(row?.[key])) throw journalError("WORKLOG_JOURNAL_SOURCE_INVALID","업무일지 데이터 형식이 올바르지 않습니다.");
      }
      return Object.freeze({
        workspaceId,
        targetDate,
        today,
        schedules:Object.freeze(row.schedules.map(toSchedule).filter((item)=>item.title && item.startsAt)),
        completed:Object.freeze(row.completed.map(toRecord).filter((item)=>item.title)),
        notes:Object.freeze(row.notes.map(toNote).filter((item)=>item.title)),
        openTasks:Object.freeze(row.open_tasks.map(toRecord).filter((item)=>item.title)),
      });
    },
  });
}
