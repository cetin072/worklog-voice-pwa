// Pure assessment only. Never links identities, revives accounts, or edits Auth.
export function identityPreflight({erpActor,worklogActor,targetEmailOccupants=[]}={}){
  const blockers=[];
  if(!erpActor?.id||erpActor.accountStatus!=='active'||!erpActor.emailVerified)blockers.push('ERP_ACCOUNT_NOT_VERIFIED_ACTIVE');
  if(!worklogActor?.id||!worklogActor.emailVerified||!worklogActor.providers?.includes('google'))blockers.push('WORKLOG_GOOGLE_IDENTITY_NOT_VERIFIED');
  // Even deleted app profiles may retain an Auth row and business audit history.
  // Different provider/email accounts cannot be silently merged based on a name.
  if(targetEmailOccupants.some(a=>a.id!==erpActor?.id))blockers.push('GOOGLE_EMAIL_COLLISION');
  return Object.freeze({ready:blockers.length===0,preserveErpAuthId:true,method:'link_google_identity_to_existing_erp_user',requiresInteractiveGoogleLogin:true,blockers:Object.freeze(blockers)});
}
