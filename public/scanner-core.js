(()=>{
  function clamp(value,min,max){ return Math.max(min,Math.min(max,value)); }
  function solveLinear(matrix,vector){
    const n=vector.length;
    const a=matrix.map((row,index)=>[...row,vector[index]]);
    for(let col=0;col<n;col++){
      let pivot=col;
      for(let row=col+1;row<n;row++) if(Math.abs(a[row][col])>Math.abs(a[pivot][col])) pivot=row;
      if(Math.abs(a[pivot][col])<1e-10) throw new Error("singular-matrix");
      [a[col],a[pivot]]=[a[pivot],a[col]];
      const divisor=a[col][col];
      for(let j=col;j<=n;j++) a[col][j]/=divisor;
      for(let row=0;row<n;row++){
        if(row===col) continue;
        const factor=a[row][col];
        if(Math.abs(factor)<1e-12) continue;
        for(let j=col;j<=n;j++) a[row][j]-=factor*a[col][j];
      }
    }
    return a.map(row=>row[n]);
  }
  function homographyFromUnitSquare(corners,width,height){
    const points=[corners.topLeftCorner,corners.topRightCorner,corners.bottomRightCorner,corners.bottomLeftCorner];
    const dest=[[0,0],[1,0],[1,1],[0,1]];
    const matrix=[],vector=[];
    for(let i=0;i<4;i++){
      const [u,v]=dest[i],x=clamp(points[i].x/Math.max(1,width),0,1),y=clamp(points[i].y/Math.max(1,height),0,1);
      matrix.push([u,v,1,0,0,0,-x*u,-x*v]); vector.push(x);
      matrix.push([0,0,0,u,v,1,-y*u,-y*v]); vector.push(y);
    }
    return solveLinear(matrix,vector);
  }
  function weightedFit(points,independentKey,dependentKey){
    if(points.length<6) return null;
    let sw=0,sx=0,sy=0,sxx=0,sxy=0;
    for(const point of points){
      const weight=Math.max(1,point.weight||1),x=point[independentKey],y=point[dependentKey];
      sw+=weight; sx+=weight*x; sy+=weight*y; sxx+=weight*x*x; sxy+=weight*x*y;
    }
    const denominator=sw*sxx-sx*sx;
    if(Math.abs(denominator)<1e-6) return {a:0,b:sy/sw};
    const a=(sw*sxy-sx*sy)/denominator;
    return {a,b:(sy-a*sx)/sw};
  }
  function robustFit(points,independentKey,dependentKey){
    let fit=weightedFit(points,independentKey,dependentKey);
    if(!fit) return null;
    const residuals=points.map(point=>Math.abs(point[dependentKey]-(fit.a*point[independentKey]+fit.b))).sort((a,b)=>a-b);
    const cutoff=residuals[Math.min(residuals.length-1,Math.floor(residuals.length*.72))]||Infinity;
    return weightedFit(points.filter(point=>Math.abs(point[dependentKey]-(fit.a*point[independentKey]+fit.b))<=Math.max(2,cutoff)),independentKey,dependentKey)||fit;
  }
  function intersect(vertical,horizontal){
    if(!vertical||!horizontal) return null;
    const denominator=1-vertical.a*horizontal.a;
    if(Math.abs(denominator)<1e-6) return null;
    const x=(vertical.a*horizontal.b+vertical.b)/denominator;
    return {x,y:horizontal.a*x+horizontal.b};
  }
  function polygonArea(points){
    let sum=0;
    for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];sum+=a.x*b.y-b.x*a.y;}
    return Math.abs(sum)/2;
  }
  function validQuad(corners,width,height){
    if(!corners) return false;
    const points=[corners.topLeftCorner,corners.topRightCorner,corners.bottomRightCorner,corners.bottomLeftCorner];
    if(points.some(point=>!Number.isFinite(point?.x)||!Number.isFinite(point?.y))) return false;
    if(points.some(point=>point.x<-width*.12||point.x>width*1.12||point.y<-height*.12||point.y>height*1.12)) return false;
    if(polygonArea(points)<width*height*.18) return false;
    const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    return distance(points[0],points[1])>=width*.22&&distance(points[3],points[2])>=width*.22&&distance(points[0],points[3])>=height*.22&&distance(points[1],points[2])>=height*.22;
  }
  function detectDocumentCorners(imageData,width,height){
    const data=imageData?.data||imageData;
    if(!data||width<32||height<32||data.length<width*height*4) return null;
    const gray=new Float32Array(width*height);
    for(let i=0,p=0;i<gray.length;i++,p+=4) gray[i]=data[p]*.299+data[p+1]*.587+data[p+2]*.114;
    const at=(x,y)=>gray[y*width+x],left=[],right=[],top=[],bottom=[],minScore=18;
    for(let y=Math.max(2,Math.floor(height*.06));y<=Math.min(height-3,Math.ceil(height*.94));y+=2){
      let bestL={score:0,x:0},bestR={score:0,x:width-1};
      for(let x=2;x<Math.floor(width*.48);x++){const score=Math.abs(at(x+1,y)-at(x-1,y));if(score>bestL.score)bestL={score,x};}
      for(let x=Math.ceil(width*.52);x<width-2;x++){const score=Math.abs(at(x+1,y)-at(x-1,y));if(score>bestR.score)bestR={score,x};}
      if(bestL.score>=minScore) left.push({x:bestL.x,y,weight:bestL.score*bestL.score});
      if(bestR.score>=minScore) right.push({x:bestR.x,y,weight:bestR.score*bestR.score});
    }
    for(let x=Math.max(2,Math.floor(width*.06));x<=Math.min(width-3,Math.ceil(width*.94));x+=2){
      let bestT={score:0,y:0},bestB={score:0,y:height-1};
      for(let y=2;y<Math.floor(height*.48);y++){const score=Math.abs(at(x,y+1)-at(x,y-1));if(score>bestT.score)bestT={score,y};}
      for(let y=Math.ceil(height*.52);y<height-2;y++){const score=Math.abs(at(x,y+1)-at(x,y-1));if(score>bestB.score)bestB={score,y};}
      if(bestT.score>=minScore) top.push({x,y:bestT.y,weight:bestT.score*bestT.score});
      if(bestB.score>=minScore) bottom.push({x,y:bestB.y,weight:bestB.score*bestB.score});
    }
    const leftLine=robustFit(left,"y","x"),rightLine=robustFit(right,"y","x"),topLine=robustFit(top,"x","y"),bottomLine=robustFit(bottom,"x","y");
    const corners={topLeftCorner:intersect(leftLine,topLine),topRightCorner:intersect(rightLine,topLine),bottomRightCorner:intersect(rightLine,bottomLine),bottomLeftCorner:intersect(leftLine,bottomLine)};
    return validQuad(corners,width,height)?corners:null;
  }
  window.WorklogScannerCore={homographyFromUnitSquare,detectDocumentCorners,validQuad};
})();