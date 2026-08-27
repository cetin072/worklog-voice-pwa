(()=>{
  const manual=document.getElementById("manualEntry");
  const text=document.getElementById("text");
  const typedSave=document.getElementById("typedSave");
  const primarySave=document.getElementById("save");
  const mic=document.getElementById("mic");
  const hint=document.getElementById("hint");

  if(!manual || !text) return;

  manual.addEventListener("click",()=>{
    if(mic?.classList.contains("listening")) mic.click();
    text.scrollIntoView({behavior:"smooth",block:"center"});
    setTimeout(()=>{
      try{ text.focus({preventScroll:true}); }
      catch{ text.focus(); }
    },280);
    if(hint) hint.textContent="직접 입력 후 아래 Notion에 저장을 누르세요.";
  });

  typedSave?.addEventListener("click",()=>{
    primarySave?.click();
  });
})();
