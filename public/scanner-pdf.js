((root)=>{
  const encoder=new TextEncoder();
  const ascii=value=>encoder.encode(String(value));
  const concat=chunks=>{const size=chunks.reduce((sum,chunk)=>sum+chunk.length,0),out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;};
  const safeName=value=>{
    let name=String(value||'').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-').replace(/\s+/g,' ');
    if(!name)name='스캔 문서';
    name=name.replace(/\.pdf$/i,'').trim()||'스캔 문서';
    return `${name}.pdf`;
  };
  if(typeof root.File!=='function'&&typeof Blob==='function'){
    try{Object.defineProperty(root,'File',{configurable:true,writable:true,value:class File extends Blob{constructor(parts,name,options={}){super(parts,options);this.name=String(name);this.lastModified=Number(options.lastModified)||Date.now();}}});}catch{}
  }
  if(root.navigator&&typeof root.navigator.share==='function'&&typeof root.navigator.canShare!=='function'){
    try{root.navigator.canShare=()=>false;}catch{}
  }
  const a4For=(width,height)=>width>height?{width:841.89,height:595.28}:{width:595.28,height:841.89};
  async function createPdf(pages){
    if(!Array.isArray(pages)||!pages.length)throw new Error('PDF로 만들 페이지가 없습니다.');
    const normalized=[];
    for(const page of pages){
      if(!page?.blob||!Number.isFinite(page.width)||!Number.isFinite(page.height)||page.width<=0||page.height<=0)throw new Error('PDF 페이지 정보가 올바르지 않습니다.');
      const bytes=new Uint8Array(await page.blob.arrayBuffer());
      normalized.push({bytes,width:Math.round(page.width),height:Math.round(page.height)});
    }
    const objectCount=2+normalized.length*3;
    const objects=new Array(objectCount+1);
    const pageRefs=[];
    normalized.forEach((page,index)=>{
      const pageId=3+index*3,imageId=pageId+1,contentId=pageId+2;
      pageRefs.push(`${pageId} 0 R`);
      const media=a4For(page.width,page.height),scale=Math.min(media.width/page.width,media.height/page.height),drawW=page.width*scale,drawH=page.height*scale,x=(media.width-drawW)/2,y=(media.height-drawH)/2;
      const command=`q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
      const commandBytes=ascii(command);
      objects[pageId]=ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${media.width.toFixed(2)} ${media.height.toFixed(2)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
      objects[imageId]=concat([ascii(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`),page.bytes,ascii('\nendstream')]);
      objects[contentId]=concat([ascii(`<< /Length ${commandBytes.length} >>\nstream\n`),commandBytes,ascii('endstream')]);
    });
    objects[1]=ascii('<< /Type /Catalog /Pages 2 0 R >>');
    objects[2]=ascii(`<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${normalized.length} >>`);
    const chunks=[ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')],offsets=new Array(objectCount+1).fill(0);
    let cursor=chunks[0].length;
    for(let id=1;id<=objectCount;id++){
      offsets[id]=cursor;
      const head=ascii(`${id} 0 obj\n`),tail=ascii('\nendobj\n');
      chunks.push(head,objects[id],tail);cursor+=head.length+objects[id].length+tail.length;
    }
    const xrefOffset=cursor;
    const xref=[`xref\n0 ${objectCount+1}\n`,`0000000000 65535 f \n`];
    for(let id=1;id<=objectCount;id++)xref.push(`${String(offsets[id]).padStart(10,'0')} 00000 n \n`);
    const trailer=`trailer\n<< /Size ${objectCount+1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    chunks.push(ascii(xref.join('')),ascii(trailer));
    return new Blob([concat(chunks)],{type:'application/pdf'});
  }
  root.WorklogScannerPdf={createPdf,normalizeFileName:safeName};
})(typeof window!=='undefined'?window:globalThis);
