(()=>{
  const nativeFetch=window.fetch.bind(window);
  const PENDING_KEY="worklogPendingRequestV1";
  const MAX_AGE_MS=30*60*1000;

  function parsePending(){
    try{
      const value=JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
      if(!value?.id || !value?.fingerprint || Date.now()-Number(value.at || 0)>MAX_AGE_MS){
        localStorage.removeItem(PENDING_KEY);
        return null;
      }
      return value;
    }catch{
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
  }

  function fingerprint(body){
    return JSON.stringify({
      transcript:String(body?.transcript || "").trim(),
      institution:String(body?.institution || ""),
      status:String(body?.status || ""),
      type:String(body?.type || ""),
      amount:body?.amount ?? null,
      assignee:String(body?.assignee || ""),
      dueDate:body?.dueDate || null,
      followUp:String(body?.followUp || "")
    });
  }

  function requestIdFor(body){
    const fp=fingerprint(body);
    const pending=parsePending();
    if(pending?.fingerprint===fp) return {id:pending.id,fingerprint:fp};
    const id=crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(PENDING_KEY,JSON.stringify({id,fingerprint:fp,at:Date.now()}));
    return {id,fingerprint:fp};
  }

  function clearIfCurrent(id){
    const pending=parsePending();
    if(pending?.id===id) localStorage.removeItem(PENDING_KEY);
  }

  window.fetch=async(input,init={})=>{
    const url=typeof input==="string" ? input : String(input?.url || "");
    const method=String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if(!url.includes("/api/worklog") || method!=="POST" || typeof init?.body!=="string"){
      return nativeFetch(input,init);
    }

    let body;
    try{ body=JSON.parse(init.body); }
    catch{ return nativeFetch(input,init); }
    if(!body || typeof body!=="object") return nativeFetch(input,init);

    const request=requestIdFor(body);
    body.clientRequestId=request.id;

    try{
      const response=await nativeFetch(input,{...init,body:JSON.stringify(body)});
      clearIfCurrent(request.id);
      return response;
    }catch(error){
      throw error;
    }
  };
})();
