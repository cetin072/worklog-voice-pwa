(()=>{
  const TOKEN_KEY="worklogPersonalNotionToken";
  const DATA_SOURCE_KEY="worklogPersonalDataSourceId";
  const BRIEFING_PAGE_KEY="worklogPersonalBriefingPageId";
  const ORG_KEY="worklogPersonalOrganization";
  const OWNER_KEY="worklogAccessKey";
  const PERSONAL_SENTINEL="__PERSONAL_NOTION__";

  function personalConfig(){
    return {
      token:localStorage.getItem(TOKEN_KEY) || "",
      dataSourceId:localStorage.getItem(DATA_SOURCE_KEY) || "",
      briefingPageId:localStorage.getItem(BRIEFING_PAGE_KEY) || "",
      organization:localStorage.getItem(ORG_KEY) || "회사"
    };
  }

  function hasPersonal(){
    const config=personalConfig();
    return Boolean(config.token && config.dataSourceId);
  }

  function savePersonal(config){
    if(config.token) localStorage.setItem(TOKEN_KEY,config.token);
    if(config.dataSourceId) localStorage.setItem(DATA_SOURCE_KEY,config.dataSourceId);
    if(config.briefingPageId) localStorage.setItem(BRIEFING_PAGE_KEY,config.briefingPageId);
    localStorage.setItem(ORG_KEY,config.organization || "회사");
    localStorage.setItem(OWNER_KEY,PERSONAL_SENTINEL);
  }

  function clearPersonal(){
    [TOKEN_KEY,DATA_SOURCE_KEY,BRIEFING_PAGE_KEY,ORG_KEY].forEach(key=>localStorage.removeItem(key));
    if(localStorage.getItem(OWNER_KEY)===PERSONAL_SENTINEL) localStorage.removeItem(OWNER_KEY);
  }

  function ownerKey({promptIfMissing=false}={}){
    let key=localStorage.getItem(OWNER_KEY) || "";
    if(key===PERSONAL_SENTINEL){
      if(hasPersonal()) return key;
      localStorage.removeItem(OWNER_KEY);
      key="";
    }
    if(!key && promptIfMissing){
      key=(prompt("기존 운영자라면 개인 접근키를 입력하세요. 처음 사용하는 분은 취소 후 ‘내 Notion으로 시작하기’를 눌러주세요.") || "").trim();
      if(key) localStorage.setItem(OWNER_KEY,key);
    }
    return key;
  }

  function getHeaders({promptOwner=false}={}){
    const config=personalConfig();
    if(config.token && config.dataSourceId){
      return {
        "x-notion-token":config.token,
        "x-notion-data-source-id":config.dataSourceId
      };
    }

    const key=ownerKey({promptIfMissing:promptOwner});
    return key && key!==PERSONAL_SENTINEL ? {"x-worklog-key":key} : {};
  }

  function mode(){
    if(hasPersonal()) return "personal";
    const key=localStorage.getItem(OWNER_KEY) || "";
    if(key && key!==PERSONAL_SENTINEL) return "owner";
    return "unset";
  }

  function escapeHtml(value){
    return String(value)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function configureInstitutionSelect(){
    if(!hasPersonal()) return;
    const select=document.getElementById("institution");
    if(!select) return;

    const organization=personalConfig().organization || "회사";
    const values=[organization,"개인","기타"].filter((value,index,array)=>array.indexOf(value)===index);
    select.innerHTML=values.map((value,index)=>`<option value="${escapeHtml(value)}"${index===0 ? " selected" : ""}>${escapeHtml(value)}</option>`).join("");
  }

  const nativeFetch=window.fetch.bind(window);
  window.fetch=(input,init={})=>{
    const url=typeof input==="string" ? input : String(input?.url || "");
    const shouldAttach=hasPersonal() && (url.includes("/api/worklog") || url.includes("/api/briefing"));
    if(!shouldAttach) return nativeFetch(input,init);

    const headers=new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    const authHeaders=getHeaders();
    Object.entries(authHeaders).forEach(([key,value])=>headers.set(key,value));
    return nativeFetch(input,{...init,headers});
  };

  window.WorklogAuth={
    personalConfig,
    hasPersonal,
    savePersonal,
    clearPersonal,
    ownerKey,
    getHeaders,
    mode,
    configureInstitutionSelect
  };

  configureInstitutionSelect();
})();
