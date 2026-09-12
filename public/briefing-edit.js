(()=>{
  const root=document.getElementById("briefingV2");
  if(!root) return;

  const IS_PREVIEW_DEMO=location.hostname.startsWith("deploy-preview-") && new URLSearchParams(location.search).get("briefingDemo")==="1";
  let currentItem=null;

  const backdrop=document.createElement("div");
  backdrop.id="briefingEditModal";
  backdrop.className="briefing-edit-backdrop";
  backdrop.hidden=true;
  backdrop.innerHTML=`
    <section class="briefing-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="briefingEditTitle">
      <div class="briefing-edit-head">
        <h3 id="briefingEditTitle">업무명 수정</h3>
        <button class="briefing-edit-close" type="button" aria-label="닫기">×</button>
      </div>
      <form id="briefingEditForm">
        <label class="briefing-edit-label" for="briefingEditInput">업무명</label>
        <input id="briefingEditInput" class="briefing-edit-input" type="text" maxlength="160" autocomplete="off">
        <p class="briefing-edit-help">저장하면 Notion의 업무명도 함께 수정됩니다. 음성원문은 그대로 보존됩니다.</p>
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
  const status=backdrop.querySelector("#briefingEditStatus");
  const save=backdrop.querySelector(".briefing-edit-save");

  function authHeaders(){
    if(window.WorklogAuth?.getHeaders){
      return window.WorklogAuth.getHeaders({promptOwner:true});
    }
    let key=localStorage.getItem("worklogAccessKey") || "";
    if(!key){
      key=(window.prompt("개인 접근키를 한 번 입력하세요.") || "").trim();
      if(key) localStorage.setItem("worklogAccessKey",key);
    }
    return key ? {"x-worklog-key":key} : {};
  }

  function closeModal(){
    backdrop.hidden=true;
    currentItem=null;
    status.textContent="";
    save.disabled=false;
    save.textContent="저장";
  }

  function openModal(item){
    const strong=item.querySelector("strong");
    if(!strong) return;
    currentItem=item;
    input.value=strong.textContent.trim();
    status.textContent=IS_PREVIEW_DEMO ? "화면 미리보기에서는 실제 Notion을 수정하지 않습니다." : "";
    backdrop.hidden=false;
    requestAnimationFrame(()=>{
      input.focus();
      input.select();
    });
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
      button.title="업무명 수정";
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
    if(!currentItem) return;
    const nextTitle=String(input.value || "").replace(/\s+/g," ").trim();
    if(!nextTitle){
      status.textContent="업무명을 입력해주세요.";
      input.focus();
      return;
    }
    if(nextTitle.length>160){
      status.textContent="업무명은 160자 이하로 입력해주세요.";
      return;
    }

    const item=currentItem;
    const complete=item.querySelector(".briefing-v2-complete");
    const pageId=complete?.dataset?.pageId || "";

    if(IS_PREVIEW_DEMO){
      updateVisibleTitle(item,nextTitle);
      status.textContent="미리보기 화면에서만 수정했습니다.";
      setTimeout(closeModal,350);
      return;
    }

    if(!pageId){
      status.textContent="수정할 업무를 찾지 못했습니다.";
      return;
    }

    const headers=authHeaders();
    if(!Object.keys(headers).length){
      status.textContent="Notion 연결 또는 개인 접근키가 필요합니다.";
      return;
    }

    save.disabled=true;
    save.textContent="저장 중…";
    status.textContent="";
    try{
      const res=await fetch("/api/worklog-edit",{
        method:"POST",
        headers:{...headers,"content-type":"application/json"},
        body:JSON.stringify({pageId,title:nextTitle}),
        cache:"no-store"
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || "업무명 수정에 실패했습니다.");
      updateVisibleTitle(item,String(data.title || nextTitle));
      status.textContent="Notion 업무명까지 수정했습니다.";
      setTimeout(closeModal,450);
    }catch(error){
      status.textContent=error?.message || "업무명 수정에 실패했습니다.";
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

  form.addEventListener("submit",event=>{
    event.preventDefault();
    saveEdit();
  });
  backdrop.querySelector(".briefing-edit-close").addEventListener("click",closeModal);
  backdrop.querySelector(".briefing-edit-cancel").addEventListener("click",closeModal);
  backdrop.addEventListener("click",event=>{
    if(event.target===backdrop) closeModal();
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape" && !backdrop.hidden) closeModal();
  });

  const observer=new MutationObserver(()=>injectEditButtons());
  observer.observe(root,{childList:true,subtree:true});
  injectEditButtons();
})();
