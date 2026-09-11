(()=>{
  const OPEN_CV_URL="https://docs.opencv.org/4.7.0/opencv.js";
  const JSCANIFY_URL="https://cdn.jsdelivr.net/npm/jscanify@1.4.3/src/jscanify.min.js";
  const MAX_WORKING_EDGE=1800;
  const MAX_OUTPUT_EDGE=2000;
  const TARGET_BYTES=1_700_000;
  const HARD_BYTES=3_100_000;
  const DB_NAME="worklog-scanner-v1";
  const STORE_NAME="scan";
  const STORE_KEY="pending";

  const scanButton=document.getElementById("scanDocument");
  const scanInput=document.getElementById("scanInput");
  const dialog=document.getElementById("scannerDialog");
  const editorCanvas=document.getElementById("scanEditorCanvas");
  const resultCanvas=document.getElementById("scanResultCanvas");
  const scanStatus=document.getElementById("scanStatus");
  const scanApply=document.getElementById("scanApply");
  const scanClose=document.getElementById("scanClose");
  const scanAutoCorners=document.getElementById("scanAutoCorners");
  const previewCard=document.getElementById("scanPreviewCard");
  const previewImage=document.getElementById("scanPreviewImage");
  const previewMeta=document.getElementById("scanPreviewMeta");
  const previewEdit=document.getElementById("scanPreviewEdit");
  const previewRemove=document.getElementById("scanPreviewRemove");
  const clearButton=document.getElementById("clear");

  if(!scanButton || !scanInput || !dialog || !editorCanvas || !resultCanvas) return;

  const editorCtx=editorCanvas.getContext("2d",{willReadFrequently:true});
  const resultCtx=resultCanvas.getContext("2d",{willReadFrequently:true});
  const sourceCanvas=document.createElement("canvas");
  const sourceCtx=sourceCanvas.getContext("2d",{willReadFrequently:true});

  let scanner=null;
  let sourceReady=false;
  let corners=null;
  let activeCorner=null;
  let filterMode="document";
  let previewUrl="";
  let pendingScan=null;
  let libsPromise=null;
  let renderTimer=null;

  const cornerKeys=["topLeftCorner","topRightCorner","bottomRightCorner","bottomLeftCorner"];

  function setStatus(message,kind=""){
    if(!scanStatus) return;
    scanStatus.textContent=message;
    scanStatus.className=`scanner-status ${kind}`.trim();
  }

  function loadScript(src,globalReady){
    if(globalReady()) return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const existing=[...document.scripts].find(script=>script.src===src);
      if(existing){
        const started=Date.now();
        const wait=()=>{
          if(globalReady()) return resolve();
          if(Date.now()-started>20000) return reject(new Error("스캔 엔진을 불러오지 못했습니다."));
          setTimeout(wait,120);
        };
        wait();
        return;
      }

      const script=document.createElement("script");
      script.src=src;
      script.async=true;
      script.onload=()=>resolve();
      script.onerror=()=>reject(new Error("스캔 엔진 다운로드에 실패했습니다."));
      document.head.appendChild(script);
    });
  }

  async function waitForOpenCv(){
    if(window.cv && typeof window.cv.then==="function"){
      window.cv=await window.cv;
    }
    if(window.cv?.Mat) return;

    const started=Date.now();
    while(Date.now()-started<20000){
      if(window.cv && typeof window.cv.then==="function"){
        window.cv=await window.cv;
      }
      if(window.cv?.Mat) return;
      await new Promise(resolve=>setTimeout(resolve,120));
    }
    throw new Error("OpenCV 초기화 시간이 너무 오래 걸립니다. 네트워크를 확인해주세요.");
  }

  function ensureLibraries(){
    if(libsPromise) return libsPromise;
    libsPromise=(async()=>{
      setStatus("문서 인식 엔진을 처음 한 번 불러오는 중입니다…");
      await loadScript(OPEN_CV_URL,()=>Boolean(window.cv?.Mat));
      await waitForOpenCv();
      await loadScript(JSCANIFY_URL,()=>typeof window.jscanify==="function");
      if(typeof window.jscanify!=="function") throw new Error("문서 인식 모듈을 시작하지 못했습니다.");
      scanner=new window.jscanify();
    })().catch(error=>{
      libsPromise=null;
      throw error;
    });
    return libsPromise;
  }

  function openDialog(){
    if(typeof dialog.showModal==="function") dialog.showModal();
    else dialog.setAttribute("open","");
    document.body.classList.add("scanner-open");
  }

  function closeDialog(){
    if(typeof dialog.close==="function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
    document.body.classList.remove("scanner-open");
  }

  function distance(a,b){
    return Math.hypot(a.x-b.x,a.y-b.y);
  }

  function validCorners(value){
    return Boolean(value && cornerKeys.every(key=>Number.isFinite(value[key]?.x) && Number.isFinite(value[key]?.y)));
  }

  function fallbackCorners(){
    const inset=Math.max(18,Math.round(Math.min(sourceCanvas.width,sourceCanvas.height)*0.035));
    return {
      topLeftCorner:{x:inset,y:inset},
      topRightCorner:{x:sourceCanvas.width-inset,y:inset},
      bottomRightCorner:{x:sourceCanvas.width-inset,y:sourceCanvas.height-inset},
      bottomLeftCorner:{x:inset,y:sourceCanvas.height-inset}
    };
  }

  function detectCorners(){
    if(!sourceReady || !scanner || !window.cv?.imread) return false;
    let mat=null;
    let contour=null;
    try{
      mat=window.cv.imread(sourceCanvas);
      contour=scanner.findPaperContour(mat);
      if(!contour) throw new Error("contour-not-found");
      const found=scanner.getCornerPoints(contour);
      if(!validCorners(found)) throw new Error("corners-not-found");
      corners={
        topLeftCorner:{...found.topLeftCorner},
        topRightCorner:{...found.topRightCorner},
        bottomRightCorner:{...found.bottomRightCorner},
        bottomLeftCorner:{...found.bottomLeftCorner}
      };
      return true;
    }catch{
      corners=fallbackCorners();
      return false;
    }finally{
      try{ contour?.delete?.(); }catch{}
      try{ mat?.delete?.(); }catch{}
    }
  }

  function drawEditor(){
    if(!sourceReady || !corners) return;
    editorCanvas.width=sourceCanvas.width;
    editorCanvas.height=sourceCanvas.height;
    editorCtx.clearRect(0,0,editorCanvas.width,editorCanvas.height);
    editorCtx.drawImage(sourceCanvas,0,0);

    editorCtx.save();
    editorCtx.strokeStyle="#22c55e";
    editorCtx.fillStyle="rgba(34,197,94,.18)";
    editorCtx.lineWidth=Math.max(4,Math.round(editorCanvas.width/320));
    editorCtx.beginPath();
    editorCtx.moveTo(corners.topLeftCorner.x,corners.topLeftCorner.y);
    editorCtx.lineTo(corners.topRightCorner.x,corners.topRightCorner.y);
    editorCtx.lineTo(corners.bottomRightCorner.x,corners.bottomRightCorner.y);
    editorCtx.lineTo(corners.bottomLeftCorner.x,corners.bottomLeftCorner.y);
    editorCtx.closePath();
    editorCtx.fill();
    editorCtx.stroke();

    const radius=Math.max(14,Math.round(editorCanvas.width/55));
    for(const key of cornerKeys){
      const point=corners[key];
      editorCtx.beginPath();
      editorCtx.fillStyle="#fff";
      editorCtx.strokeStyle="#16a34a";
      editorCtx.lineWidth=Math.max(4,Math.round(editorCanvas.width/360));
      editorCtx.arc(point.x,point.y,radius,0,Math.PI*2);
      editorCtx.fill();
      editorCtx.stroke();
    }
    editorCtx.restore();
  }

  function desiredOutputSize(){
    const top=distance(corners.topLeftCorner,corners.topRightCorner);
    const bottom=distance(corners.bottomLeftCorner,corners.bottomRightCorner);
    const left=distance(corners.topLeftCorner,corners.bottomLeftCorner);
    const right=distance(corners.topRightCorner,corners.bottomRightCorner);
    let width=Math.max(420,Math.round((top+bottom)/2));
    let height=Math.max(420,Math.round((left+right)/2));
    const edge=Math.max(width,height);
    if(edge>MAX_OUTPUT_EDGE){
      const scale=MAX_OUTPUT_EDGE/edge;
      width=Math.round(width*scale);
      height=Math.round(height*scale);
    }
    return {width,height};
  }

  function applyFilter(canvas,mode){
    if(mode==="color") return;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    const image=ctx.getImageData(0,0,canvas.width,canvas.height);
    const data=image.data;
    for(let i=0;i<data.length;i+=4){
      const r=data[i],g=data[i+1],b=data[i+2];
      if(mode==="bw"){
        const gray=0.299*r+0.587*g+0.114*b;
        const value=gray>168 ? 255 : gray<105 ? 0 : Math.round((gray-105)*4.05);
        data[i]=value; data[i+1]=value; data[i+2]=value;
      }else{
        data[i]=Math.max(0,Math.min(255,(r-128)*1.16+143));
        data[i+1]=Math.max(0,Math.min(255,(g-128)*1.16+143));
        data[i+2]=Math.max(0,Math.min(255,(b-128)*1.16+143));
      }
    }
    ctx.putImageData(image,0,0);
  }

  function renderResult(){
    if(!sourceReady || !scanner || !validCorners(corners)) return;
    try{
      const {width,height}=desiredOutputSize();
      const extracted=scanner.extractPaper(sourceCanvas,width,height,corners);
      if(!extracted) throw new Error("문서 영역을 보정하지 못했습니다.");
      resultCanvas.width=extracted.width;
      resultCanvas.height=extracted.height;
      resultCtx.clearRect(0,0,resultCanvas.width,resultCanvas.height);
      resultCtx.drawImage(extracted,0,0);
      applyFilter(resultCanvas,filterMode);
      setStatus("네 귀퉁이를 끌어 문서 테두리에 맞춘 뒤 ‘이 스캔 사용’을 누르세요.","success");
    }catch(error){
      setStatus(error?.message || "문서 보정에 실패했습니다.","error");
    }
  }

  function scheduleResult(){
    clearTimeout(renderTimer);
    renderTimer=setTimeout(renderResult,120);
  }

  function pointerToCanvas(event){
    const rect=editorCanvas.getBoundingClientRect();
    return {
      x:(event.clientX-rect.left)*(editorCanvas.width/rect.width),
      y:(event.clientY-rect.top)*(editorCanvas.height/rect.height)
    };
  }

  function nearestCorner(point){
    let nearest=null;
    let best=Infinity;
    for(const key of cornerKeys){
      const d=distance(point,corners[key]);
      if(d<best){ best=d; nearest=key; }
    }
    const threshold=Math.max(editorCanvas.width,editorCanvas.height)*0.09;
    return best<=threshold ? nearest : null;
  }

  editorCanvas.addEventListener("pointerdown",event=>{
    if(!corners) return;
    const point=pointerToCanvas(event);
    activeCorner=nearestCorner(point);
    if(!activeCorner) return;
    editorCanvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  editorCanvas.addEventListener("pointermove",event=>{
    if(!activeCorner || !corners) return;
    const point=pointerToCanvas(event);
    corners[activeCorner]={
      x:Math.max(0,Math.min(editorCanvas.width,point.x)),
      y:Math.max(0,Math.min(editorCanvas.height,point.y))
    };
    drawEditor();
    scheduleResult();
    event.preventDefault();
  });

  const endPointer=()=>{ activeCorner=null; };
  editorCanvas.addEventListener("pointerup",endPointer);
  editorCanvas.addEventListener("pointercancel",endPointer);

  function canvasToBlob(canvas,type="image/jpeg",quality=.88){
    return new Promise((resolve,reject)=>{
      canvas.toBlob(blob=>blob ? resolve(blob) : reject(new Error("스캔 이미지를 압축하지 못했습니다.")),type,quality);
    });
  }

  async function compressedScanBlob(){
    let working=document.createElement("canvas");
    working.width=resultCanvas.width;
    working.height=resultCanvas.height;
    working.getContext("2d").drawImage(resultCanvas,0,0);

    const qualities=[.9,.86,.82,.78,.72,.66,.6,.54];
    let last=null;
    for(let round=0;round<4;round++){
      for(const quality of qualities){
        last=await canvasToBlob(working,"image/jpeg",quality);
        if(last.size<=TARGET_BYTES) return last;
      }
      if(last && last.size<=HARD_BYTES) return last;
      if(Math.max(working.width,working.height)<=1200) break;
      const resized=document.createElement("canvas");
      resized.width=Math.round(working.width*.86);
      resized.height=Math.round(working.height*.86);
      resized.getContext("2d").drawImage(working,0,0,resized.width,resized.height);
      working=resized;
    }
    if(!last) throw new Error("스캔 이미지를 만들지 못했습니다.");
    if(last.size>HARD_BYTES) throw new Error("이미지 용량을 충분히 줄이지 못했습니다. 다시 촬영해주세요.");
    return last;
  }

  function scanFileName(){
    const now=new Date();
    const pad=value=>String(value).padStart(2,"0");
    return `worklog-scan-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.jpg`;
  }

  function newRequestId(){
    return `scan-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  }

  function openDb(){
    return new Promise((resolve,reject)=>{
      if(!window.indexedDB) return reject(new Error("indexeddb-unavailable"));
      const request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=()=>{
        if(!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }

  async function persistPending(){
    if(!pendingScan) return;
    try{
      const db=await openDb();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,"readwrite");
        tx.objectStore(STORE_NAME).put({
          blob:pendingScan.blob,
          fileName:pendingScan.fileName,
          requestId:pendingScan.requestId,
          filterMode:pendingScan.filterMode,
          savedAt:Date.now()
        },STORE_KEY);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
      });
      db.close();
    }catch{}
  }

  async function restorePending(){
    try{
      const db=await openDb();
      const value=await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,"readonly");
        const request=tx.objectStore(STORE_NAME).get(STORE_KEY);
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error);
      });
      db.close();
      if(value?.blob instanceof Blob && value.blob.size>0 && Date.now()-Number(value.savedAt || 0)<24*60*60*1000){
        pendingScan={
          blob:value.blob,
          fileName:value.fileName || "worklog-scan.jpg",
          requestId:value.requestId || newRequestId(),
          filterMode:value.filterMode || "document"
        };
        updatePreview();
      }else{
        await clearPersisted();
      }
    }catch{}
  }

  async function clearPersisted(){
    try{
      const db=await openDb();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,"readwrite");
        tx.objectStore(STORE_NAME).delete(STORE_KEY);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
      });
      db.close();
    }catch{}
  }

  function formatBytes(bytes){
    if(bytes<1024*1024) return `${Math.max(1,Math.round(bytes/1024))}KB`;
    return `${(bytes/(1024*1024)).toFixed(1)}MB`;
  }

  function updatePreview(){
    if(previewUrl){ URL.revokeObjectURL(previewUrl); previewUrl=""; }
    if(!pendingScan){
      previewCard.hidden=true;
      previewImage.removeAttribute("src");
      return;
    }
    previewUrl=URL.createObjectURL(pendingScan.blob);
    previewImage.src=previewUrl;
    previewMeta.textContent=`스캔 첨부 준비 · ${formatBytes(pendingScan.blob.size)} · ${pendingScan.filterMode==="bw" ? "흑백" : pendingScan.filterMode==="color" ? "원본 색상" : "문서 보정"}`;
    previewCard.hidden=false;
  }

  async function removePending(){
    pendingScan=null;
    await clearPersisted();
    updatePreview();
  }

  function loadImage(file){
    return new Promise((resolve,reject)=>{
      const image=new Image();
      const url=URL.createObjectURL(file);
      image.onload=()=>{ URL.revokeObjectURL(url); resolve(image); };
      image.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error("사진을 열지 못했습니다.")); };
      image.src=url;
    });
  }

  async function prepareSource(file){
    const image=await loadImage(file);
    const naturalWidth=image.naturalWidth || image.width;
    const naturalHeight=image.naturalHeight || image.height;
    const edge=Math.max(naturalWidth,naturalHeight);
    const scale=Math.min(1,MAX_WORKING_EDGE/edge);
    sourceCanvas.width=Math.max(1,Math.round(naturalWidth*scale));
    sourceCanvas.height=Math.max(1,Math.round(naturalHeight*scale));
    sourceCtx.clearRect(0,0,sourceCanvas.width,sourceCanvas.height);
    sourceCtx.drawImage(image,0,0,sourceCanvas.width,sourceCanvas.height);
    sourceReady=true;
  }

  async function startScan(file){
    if(!file || !file.type?.startsWith("image/")){
      setStatus("문서 사진을 선택해주세요.","error");
      return;
    }
    openDialog();
    scanApply.disabled=true;
    setStatus("사진을 준비하는 중입니다…");
    try{
      await Promise.all([ensureLibraries(),prepareSource(file)]);
      const detected=detectCorners();
      drawEditor();
      filterMode="document";
      document.querySelectorAll("[data-scan-filter]").forEach(button=>button.classList.toggle("active",button.dataset.scanFilter===filterMode));
      renderResult();
      setStatus(detected
        ? "문서 테두리를 자동으로 찾았습니다. 필요하면 네 귀퉁이를 끌어 조정하세요."
        : "자동 테두리 인식이 불확실합니다. 네 귀퉁이를 문서 모서리에 맞춰주세요.",
        detected ? "success" : "warning");
      scanApply.disabled=false;
    }catch(error){
      setStatus(error?.message || "문서 스캔을 시작하지 못했습니다.","error");
    }finally{
      scanInput.value="";
    }
  }

  scanButton.addEventListener("click",()=>scanInput.click());
  scanInput.addEventListener("change",()=>startScan(scanInput.files?.[0]));
  scanClose?.addEventListener("click",closeDialog);
  dialog.addEventListener("cancel",event=>{ event.preventDefault(); closeDialog(); });

  scanAutoCorners?.addEventListener("click",()=>{
    if(!sourceReady) return;
    const detected=detectCorners();
    drawEditor();
    renderResult();
    setStatus(detected ? "문서 테두리를 다시 찾았습니다." : "자동 인식이 불확실합니다. 직접 네 귀퉁이를 조정해주세요.",detected ? "success" : "warning");
  });

  document.querySelectorAll("[data-scan-filter]").forEach(button=>{
    button.addEventListener("click",()=>{
      filterMode=button.dataset.scanFilter || "document";
      document.querySelectorAll("[data-scan-filter]").forEach(item=>item.classList.toggle("active",item===button));
      renderResult();
    });
  });

  scanApply?.addEventListener("click",async()=>{
    if(!sourceReady || !resultCanvas.width) return;
    scanApply.disabled=true;
    scanApply.textContent="압축 중…";
    setStatus("휴대폰 안에서 스캔 이미지를 압축하는 중입니다…");
    try{
      const blob=await compressedScanBlob();
      pendingScan={
        blob,
        fileName:scanFileName(),
        requestId:newRequestId(),
        filterMode
      };
      await persistPending();
      updatePreview();
      closeDialog();
      document.getElementById("text")?.focus({preventScroll:true});
    }catch(error){
      setStatus(error?.message || "스캔 이미지를 준비하지 못했습니다.","error");
    }finally{
      scanApply.disabled=false;
      scanApply.textContent="이 스캔 사용";
    }
  });

  previewRemove?.addEventListener("click",removePending);
  previewEdit?.addEventListener("click",()=>{
    if(sourceReady){ openDialog(); drawEditor(); renderResult(); }
    else scanInput.click();
  });
  clearButton?.addEventListener("click",()=>{ removePending(); });

  const previousFetch=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{
    const url=typeof input==="string" ? input : String(input?.url || "");
    const method=String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const isWorklogPost=url.includes("/api/worklog") && !url.includes("/api/worklog-scan") && method==="POST" && typeof init?.body==="string";
    if(!pendingScan || !isWorklogPost) return previousFetch(input,init);

    let metadata;
    try{ metadata=JSON.parse(init.body); }
    catch{ return previousFetch(input,init); }
    if(!metadata || typeof metadata!=="object") return previousFetch(input,init);

    metadata.clientRequestId=pendingScan.requestId;
    const form=new FormData();
    form.append("metadata",JSON.stringify(metadata));
    form.append("scan",pendingScan.blob,pendingScan.fileName);

    const headers=new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.delete("content-type");
    const response=await previousFetch("/api/worklog-scan",{...init,method:"POST",headers,body:form});
    if(response.ok) await removePending();
    return response;
  };

  window.WorklogScanner={
    hasPending:()=>Boolean(pendingScan),
    pendingSize:()=>pendingScan?.blob?.size || 0,
    remove:removePending
  };

  restorePending();
})();
