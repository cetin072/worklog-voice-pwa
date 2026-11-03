// Offline only: no network, SQL execution, Auth writes, or production credentials.
// Auth references come from the audited FK catalog; entity IDs/text stay unchanged.
export const AUTH_COLUMNS = Object.freeze({
  workspaces: ['owner_user_id','created_by_user_id'], workspace_members: ['user_id'],
  work_records: ['created_by_user_id','assigned_user_id'], schedules: ['created_by_user_id'],
  source_refs: ['created_by_user_id'], candidates: ['created_by_user_id'],
  input_captures: ['created_by_user_id'], work_record_normalizations: ['created_by_user_id'],
  usage_events: ['user_id'], shared_cost_pools: [], shared_cost_allocations: ['user_id'],
  notification_preferences: ['user_id'], push_subscriptions: ['user_id'], notification_deliveries: ['user_id']
});
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function remapWorklogRows(bundle,approvedUserMap){
  if(!bundle||!approvedUserMap||Array.isArray(approvedUserMap))throw new Error('INVALID_TRANSFER_INPUT');
  const entries=Object.entries(approvedUserMap);
  if(!entries.length||entries.some(([a,b])=>!UUID.test(a)||!UUID.test(b)))throw new Error('INVALID_APPROVED_USER_MAP');
  if(new Set(entries.map(([,b])=>b.toLowerCase())).size!==entries.length)throw new Error('AMBIGUOUS_ACCOUNT_MERGE');
  if(Object.keys(bundle).some(t=>!Object.hasOwn(AUTH_COLUMNS,t)))throw new Error('UNKNOWN_TABLE');
  const result={};
  for(const [table,columns] of Object.entries(AUTH_COLUMNS)){
    if(!Array.isArray(bundle[table]))throw new Error('INCOMPLETE_EXPORT:'+table);
    result[table]=bundle[table].map(row=>{
      if(!row||Array.isArray(row)||typeof row!=='object')throw new Error('INVALID_ROW:'+table);
      const copy=structuredClone(row);
      for(const col of columns){
        if(copy[col]==null)continue;
        if(!Object.hasOwn(approvedUserMap,copy[col]))throw new Error('UNMAPPED_AUTH_USER:'+table+'.'+col);
        copy[col]=approvedUserMap[copy[col]];
      }
      // Delivery state is retained for history, never restarted in a new project.
      if(table==='push_subscriptions')copy.disabled_at=copy.disabled_at||'1970-01-01T00:00:00.000Z';
      return copy;
    });
  }
  const personalOwners=result.workspaces.filter(w=>w.kind==='personal').map(w=>w.owner_user_id);
  if(new Set(personalOwners).size!==personalOwners.length)throw new Error('PERSONAL_WORKSPACE_COLLISION');
  return result;
}
export function transferCounts(bundle){return Object.fromEntries(Object.entries(AUTH_COLUMNS).map(([t])=>[t,bundle[t].length]));}
