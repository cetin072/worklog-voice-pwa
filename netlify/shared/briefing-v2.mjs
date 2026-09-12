const DEFAULT_EXCLUDED_PROJECTS = new Set([
  "SYSTEM_DAILY_BRIEFING",
  "SYSTEM_SPLIT_SOURCE",
  "SYSTEM_TEST"
]);

function clean(value){
  return String(value || "").trim();
}

function dateKey(value){
  const text=clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function dayDistance(fromKey,toKey){
  if(!dateKey(fromKey) || !dateKey(toKey)) return null;
  const from=Date.parse(`${fromKey}T00:00:00Z`);
  const to=Date.parse(`${toKey}T00:00:00Z`);
  if(!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to-from)/(24*60*60*1000));
}

function normalizedTask(task){
  return {
    pageId:clean(task?.pageId),
    title:clean(task?.title),
    institution:clean(task?.institution),
    status:clean(task?.status),
    project:clean(task?.project),
    dueKey:dateKey(task?.dueKey),
    followUp:clean(task?.followUp),
    editedAt:clean(task?.editedAt)
  };
}

function editedDesc(a,b){
  return String(b.editedAt || "").localeCompare(String(a.editedAt || ""));
}

function dueThenEdited(a,b){
  if(a.dueKey && b.dueKey && a.dueKey!==b.dueKey) return a.dueKey.localeCompare(b.dueKey);
  if(a.dueKey && !b.dueKey) return -1;
  if(!a.dueKey && b.dueKey) return 1;
  return editedDesc(a,b);
}

function decorate(task,today){
  const diff=task.dueKey ? dayDistance(today,task.dueKey) : null;
  return {
    ...task,
    daysOverdue:typeof diff==="number" && diff<0 ? Math.abs(diff) : 0,
    daysUntil:typeof diff==="number" && diff>0 ? diff : 0
  };
}

/**
 * Briefing 2.0 deterministic classifier.
 *
 * Precedence is intentionally exclusive:
 * overdue > today > waiting > followUp > other.
 * A task is therefore shown in only one primary dashboard section.
 */
export function classifyBriefingTasks(rawTasks,today,options={}){
  const todayKey=dateKey(today);
  if(!todayKey) throw new Error("today must be YYYY-MM-DD");

  const excludedProjects=options.excludedProjects || DEFAULT_EXCLUDED_PROJECTS;
  const allowedStatuses=options.allowedStatuses || new Set(["진행중","대기","확인필요"]);

  const structure={
    overdue:[],
    today:[],
    waiting:[],
    followUp:[],
    otherCount:0,
    totalOpen:0
  };

  for(const raw of Array.isArray(rawTasks) ? rawTasks : []){
    const task=normalizedTask(raw);
    if(!task.title) continue;
    if(task.status==="완료") continue;
    if(!allowedStatuses.has(task.status)) continue;
    if(excludedProjects.has(task.project)) continue;

    structure.totalOpen+=1;
    const item=decorate(task,todayKey);

    if(task.dueKey && task.dueKey<todayKey){
      structure.overdue.push(item);
      continue;
    }

    if(task.dueKey===todayKey){
      structure.today.push(item);
      continue;
    }

    if(task.status==="대기"){
      structure.waiting.push(item);
      continue;
    }

    if(task.followUp || task.status==="확인필요"){
      structure.followUp.push(item);
      continue;
    }

    structure.otherCount+=1;
  }

  structure.overdue.sort(dueThenEdited);
  structure.today.sort(editedDesc);
  structure.waiting.sort(dueThenEdited);
  structure.followUp.sort(dueThenEdited);

  return structure;
}

export function briefingV2Counts(structure){
  return {
    overdue:Array.isArray(structure?.overdue) ? structure.overdue.length : 0,
    today:Array.isArray(structure?.today) ? structure.today.length : 0,
    waiting:Array.isArray(structure?.waiting) ? structure.waiting.length : 0,
    followUp:Array.isArray(structure?.followUp) ? structure.followUp.length : 0,
    other:Number(structure?.otherCount || 0),
    total:Number(structure?.totalOpen || 0)
  };
}
