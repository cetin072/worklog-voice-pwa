(()=>{
  const root=document.getElementById("briefingV2");
  const meta=document.getElementById("briefingMeta");
  if(!root || !meta) return;

  const previewDemo=location.hostname.startsWith("deploy-preview-")
    && new URLSearchParams(location.search).get("briefingDemo")==="1";
  let requested=false;

  function loadEditAssets(){
    if(requested) return;
    requested=true;

    if(!document.querySelector('link[data-briefing-edit-style]')){
      const link=document.createElement("link");
      link.rel="stylesheet";
      link.href="/briefing-edit.css";
      link.dataset.briefingEditStyle="1";
      document.head.appendChild(link);
    }

    if(!document.querySelector('script[data-briefing-edit-script]')){
      const script=document.createElement("script");
      script.src="/briefing-edit.js";
      script.defer=true;
      script.dataset.briefingEditScript="1";
      document.head.appendChild(script);
    }
  }

  function maybeLoad(){
    if(requested || root.hidden) return;
    const label=String(meta.textContent || "");
    if(label.includes("Data Core 기준")) return;
    if(!previewDemo && !label.includes("Notion 최신 기준")) return;
    loadEditAssets();
  }

  const observer=new MutationObserver(maybeLoad);
  observer.observe(root,{attributes:true,attributeFilter:["hidden"]});
  observer.observe(meta,{childList:true,subtree:true,characterData:true});
  maybeLoad();
})();
