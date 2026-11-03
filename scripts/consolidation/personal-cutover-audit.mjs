// Read-only fingerprints and offline comparison. Never copies, deletes, or picks a winner.
import { AUTH_COLUMNS } from './remap-worklog-rows.mjs';

export const CUTOVER_TABLES = Object.freeze(['workspaces', 'workspace_members', 'work_records', 'schedules']);
export function personalCutoverQuery(schema, actor) {
  if (!['public', 'worklog'].includes(schema) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(actor)) {
    throw new Error('INVALID_AUDIT_SCOPE');
  }
  actor = actor.toLowerCase();
  const own = `select id from ${schema}.workspaces where kind='personal' and owner_user_id='${actor}'`;
  const selects = CUTOVER_TABLES.map(table => {
    const key = table === 'workspace_members' ? "r.workspace_id::text || ':owner'" : 'r.id::text';
    const where = table === 'workspaces' ? `r.id in (${own})`
      : `r.workspace_id in (${own})${table === 'workspace_members' ? ` and r.user_id='${actor}' and r.role='owner'` : ''}`;
    const cols = AUTH_COLUMNS[table].map(c => `'${c}'`).join(',');
    return `select '${table}' table_name, ${key} id, md5((select jsonb_object_agg(key,case when key in (${cols}) and value=to_jsonb('${actor}'::text) then to_jsonb('approved-person'::text) else value end) from jsonb_each(to_jsonb(r)))::text) fingerprint from ${schema}.${table} r where ${where}`;
  });
  return `with rows as (${selects.join(' union all ')}) select jsonb_build_object('format','personal-cutover-fingerprints-v1','tables',(select jsonb_object_agg(t,coalesce((select jsonb_agg(jsonb_build_object('id',id,'fingerprint',fingerprint) order by id) from rows where table_name=t),'[]'::jsonb)) from unnest(array[${CUTOVER_TABLES.map(t=>`'${t}'`).join(',')}]) t)) snapshot`;
}

function index(snapshot) {
  if (snapshot?.format !== 'personal-cutover-fingerprints-v1' || !snapshot.tables ||
      Object.keys(snapshot.tables).length !== CUTOVER_TABLES.length) throw new Error('INCOMPLETE_AUDIT');
  return Object.fromEntries(CUTOVER_TABLES.map(table => {
    const rows = snapshot.tables[table];
    if (!Array.isArray(rows)) throw new Error('INCOMPLETE_AUDIT');
    const map = new Map();
    for (const row of rows) {
      if (typeof row?.id !== 'string' || !row.id || !/^[0-9a-f]{32}$/.test(row.fingerprint)) throw new Error('INVALID_FINGERPRINT');
      if (map.has(row.id)) throw new Error('DUPLICATE_ENTITY');
      map.set(row.id, row.fingerprint);
    }
    if (['workspaces','workspace_members'].includes(table) && map.size !== 1) throw new Error('PERSONAL_OWNER_SCOPE_REQUIRED');
    return [table, map];
  }));
}

export function comparePersonalCutover(source, target) {
  const a = index(source), b = index(target);
  const tables = Object.fromEntries(CUTOVER_TABLES.map(table => {
    const sourceOnly = [], targetOnly = [], changed = [];
    let same = 0;
    for (const [id, hash] of a[table]) {
      if (!b[table].has(id)) sourceOnly.push(id);
      else if (b[table].get(id) !== hash) changed.push(id);
      else same++;
    }
    for (const id of b[table].keys()) if (!a[table].has(id)) targetOnly.push(id);
    return [table, { sourceCount: a[table].size, targetCount: b[table].size, same,
      sourceOnly: sourceOnly.sort(), targetOnly: targetOnly.sort(), changed: changed.sort() }];
  }));
  const differences = Object.values(tables).some(t=>t.sourceOnly.length || t.targetOnly.length || t.changed.length);
  return { status: differences ? 'RECONCILIATION_REQUIRED' : 'CORE_MATCH', tables,
    productionReady: false, localDraftsVerified: false, attachmentsVerified: false, notificationsVerified: false };
}
