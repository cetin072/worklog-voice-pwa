(()=>{
  const root=document.getElementById("briefingV2");
  if(!root) return;

  const IS_PREVIEW_DEMO=location.hostname.startsWith("deploy-preview-") && new URLSearchParams(location.search).get("briefingDemo")==="1";
  let currentItem=null;
  let detailsLoaded=false;

  const backdrop=document.createElement("div");
  backdrop.id="briefingEditModal";
  backdrop.className="briefing-edit-backdrop";
  backdrop.hidden=true;
  backdrop.innerHTML=`
    <section class="briefing-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="briefingEditTitle">
      <div class="briefing-edit-head">
        <h3 id="briefingEditTitle">업무 수정</h3>
        <button class="briefing-edit-close" type="button" aria-label="닫기">×</button>
      </div>
      <form id="briefingEditForm">
        <label class="briefing-edit-label" for="briefingEditInput">업무명</label>
        <input id="briefingEditInput" class="briefing-edit-input" type="text" maxlength="160" autocomplete="off">
        <div class="briefing-edit-datetime">
          <label><span class="briefing-edit-label">날짜</span><input id="briefingEditDate" class="briefing-edit-date" type="date"></label>
          <label><span class="briefing-edit-label">시간 <small>선택</small></span><input id="briefingEditTime" class="briefing-edit-time" type="time" step="60"></label>
        </div>
        <p class="briefing-edit-help"></p>
        <p id="briefingEditStatus" class="briefing-edit-status" aria-live="polite"></p>
        <div class="briefing-edit-actions">
          <button class="briefing-edit-cancel" type="button">취소</button>
          <button class="briefing-edit-save" type="submit">저장</button>
        </div>
      </form>
    </section>`;
  document.body.appendChild(backdrop);

  const form=backdrop.querySelector("#briefingEditForm");
  const input=backdrop.querySelector("#briefingEditInput");
  const dateInput=backdrop.querySelector("#briefingEditDate");
  const timeInput=backdrop.querySelector("#briefingEditTime");
  const help=backdrop.querySelector(".briefing-edit-help");
  const status=backdrop.querySelector("#briefingEditStatus");
  const save=backdrop.querySelector(".briefing-edit-save");

  function mode(){
    const explicit=String(root.dataset.mode || "").trim();
    if(explicit) return explicit;
    const meta=String(document.getElementById("briefingMeta")?.textContent || "");
    return meta.includes("Data Core 기준") ? "data_core" : "notion";
  }

  function authHeaders(){
    if(mode()==="data_core"){
      const session=window.WorklogPlatformAuth?.readSession?.();
      return session?.access_token ? {authorization:`Bearer ${session.access_token}`} : {};
    }
    if(window.WorklogAuth?.getHeaders) return window.WorklogAuth.getHeaders({promptOwner:true});
    let key=localStorage.getItem("worklogAccessKey") || "";
    if(!key){
      key=(window.prompt("개인 접근키를 한 번 입력하세요.") || "").trim();
      if(key) localStorage.setItem("worklogAccessKey",key);
    }
    return key ? {"x-worklog-key":key} : {};
  }

  function pageIdFor(item){
    return item?.querySelector(".briefing-v2-complete")?.dataset?.pageId || "";
  }

  function closeModal(){
    backdrop.hidden=true;
    currentItem=null;
    detailsLoaded=false;
    input.value="";
    dateInput.value="";
    timeInput.value="";
    status.textContent="";
    save.disabled=false;
    save.textContent="저장";
  }

  async function readCurrentDetails(item){
    const editMode=mode();
    const headers=authHeaders();
    if(!Object.keys(headers).length) throw new Error(editMode==="data_core" ? "로그인 세션을 확인할 수 없습니다. 다시 로그인해주세요." : "Notion 연결 또는 개인 접근키가 필요합니다.");
    const pageId=pageIdFor(item);
    if(!pageId) throw new Error("수정할 업무를 찾지 못했습니다.");
    const res=await fetch("/api/worklog-edit",{
      method:"POST",
      headers:{...headers,"content-type":"application/json"},
      body:JSON.stringify({action:"read",pageId}),
      cache:"no-store"
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || "업무 정보를 불러오지 못했습니다.");
    return data;
  }

  async function openModal(item){
    const strong=item.querySelector("strong");
    if(!strong) return;
    currentItem=item;
    detailsLoaded=false;
    input.value=strong.textContent.trim();
    dateInput.value="";
    timeInput.value="";
    const dataCore=mode()==="data_core";
    help.textContent=dataCore
      ? "업무명과 기한을 함께 수정합니다. 날짜를 비우면 기한 없는 업무가 됩니다. 음성원문은 보존됩니다."
      : "업무명과 기한을 함께 수정합니다. 음성원문은 그대로 보존됩니다.";
    backdrop.hidden=false;

    if(IS_PREVIEW_DEMO){
      detailsLoaded=true;
      save.disabled=false;
      status.textContent="화면 미리보기에서는 실제 데이터를 수정하지 않습니다.";
      requestAnimationFrame(()=>input.focus());
      return;
    }

    save.disabled=true;
    status.textContent="현재 업무 정보를 불러오는 중입니다.";
    try{
      const data=await readCurrentDetails(item);
      if(currentItem!==item) return;
      input.value=String(data.title || strong.textContent || "").trim();
      dateInput.value=String(data.dueDate || "");
      timeInput.value=String(data.dueTime || "");
      detailsLoaded=true;
      status.textContent="";
      save.disabled=false;
      requestAnimationFrame(()=>{
        input.focus();
        input.select();
      });
    }catch(error){
      if(currentItem!==item) return;
      detailsLoaded=false;
      save.disabled=true;
      status.textContent=error?.message || "업무 정보를 불러오지 못했습니다.";
    }
  }

  function injectEditButtons(){
    root.querySelectorAll(".briefing-v2-list > li").forEach((item,index)=>{
      if(item.querySelector(".briefing-v2-edit")) return;
      const complete=item.querySelector(".briefing-v2-complete");
      const strong=item.querySelector("strong");
      if(!complete || !strong) return;
      const pageId=complete.dataset.pageId || (IS_PREVIEW_DEMO ? `demo-${index}` : "");
      if(!pageId) return;
      const button=document.createElement("button");
      button.type="button";
      button.className="briefing-v2-edit";
      button.textContent="✏️";
      button.setAttribute("aria-label",`${strong.textContent.trim()} 수정`);
      button.title="업무 수정";
      complete.insertAdjacentElement("beforebegin",button);
    });
  }

  function updateVisibleTitle(item,nextTitle){
    const strong=item.querySelector("strong");
    const complete=item.querySelector(".briefing-v2-complete");
    const edit=item.querySelector(".briefing-v2-edit");
    if(strong) strong.textContent=nextTitle;
    if(complete?.dataset) complete.dataset.title=nextTitle;
    if(edit) edit.setAttribute("aria-label",`${nextTitle} 수정`);
  }

  async function saveEdit(){
    if(!currentItem || !detailsLoaded) return;
    const nextTitle=String(input.value || "").replace(/\s+/g," ").trim();
    if(!nextTitle){ status.textContent="업무명을 입력해주세요."; input.focus(); return; }
    if(nextTitle.length>160){ status.textContent="업무명은 160자 이하로 입력해주세요."; return; }
    if(timeInput.value && !dateInput.value){ status.textContent="시간을 설정하려면 날짜도 입력해주세요."; dateInput.focus(); return; }

    const item=currentItem;
    const pageId=pageIdFor(item);
    if(IS_PREVIEW_DEMO){
      updateVisibleTitle(item,nextTitle);
      status.textContent="미리보기 화면에서만 수정했습니다.";
      setTimeout(closeModal,350);
      return;
    }
    if(!pageId){ status.textContent="수정할 업무를 찾지 못했습니다."; return; }

    const editMode=mode();
    const headers=authHeaders();
    if(!Object.keys(headers).length){
      status.textContent=editMode==="data_core" ? "로그인 세션을 확인할 수 없습니다. 다시 로그인해주세요." : "Notion 연결 또는 개인 접근키가 필요합니다.";
      return;
    }

    save.disabled=true;
    save.textContent="저장 중…";
    status.textContent="";
    try{
      const res=await fetch("/api/worklog-edit",{
        method:"POST",
        headers:{...headers,"content-type":"application/json"},
        body:JSON.stringify({action:"update",pageId,title:nextTitle,dueDate:dateInput.value || "",dueTime:timeInput.value || ""}),
        cache:"no-store"
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || "업무 수정에 실패했습니다.");
      updateVisibleTitle(item,String(data.title || nextTitle));
      status.textContent=data.mode==="data_core" ? "업무를 수정했습니다." : "Notion 업무까지 수정했습니다.";
      if(data.mode==="data_core") window.dispatchEvent(new CustomEvent("worklog:record-saved",{detail:{source:"briefing-edit"}}));
      setTimeout(closeModal,450);
    }catch(error){
      status.textContent=error?.message || "업무 수정에 실패했습니다.";
      save.disabled=false;
      save.textContent="저장";
    }
  }

  root.addEventListener("click",event=>{
    const button=event.target.closest?.(".briefing-v2-edit");
    if(!button) return;
    const item=button.closest("li");
    if(item) openModal(item);
  });
  form.addEventListener("submit",event=>{ event.preventDefault(); saveEdit(); });
  dateInput.addEventListener("change",()=>{ if(!dateInput.value) timeInput.value=""; });
  backdrop.querySelector(".briefing-edit-close").addEventListener("click",closeModal);
  backdrop.querySelector(".briefing-edit-cancel").addEventListener("click",closeModal);
  backdrop.addEventListener("click",event=>{ if(event.target===backdrop) closeModal(); });
  document.addEventListener("keydown",event=>{ if(event.key==="Escape" && !backdrop.hidden) closeModal(); });

  const observer=new MutationObserver(()=>injectEditButtons());
  observer.observe(root,{childList:true,subtree:true});
  injectEditButtons();
})();
