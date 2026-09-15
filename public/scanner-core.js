(()=>{
  function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
  function solveLinear(matrix,vector){
    const n=vector.length,a=matrix.map((row,index)=>[...row,vector[index]]);
    for(let col=0;col<n;col++){
      let pivot=col;
      for(let row=col+1;row<n;row++)if(Math.abs(a[row][col])>Math.abs(a[pivot][col]))pivot=row;
      if(Math.abs(a[pivot][col])<1e-10)throw new Error("singular-matrix");
      [a[col],a[pivot]]=[a[pivot],a[col]];
      const divisor=a[col][col];
      for(let j=col;j<=n;j++)a[col][j]/=divisor;
      for(let row=0;row<n;row++){
        if(row===col)continue;
        const factor=a[row][col];
        if(Math.abs(factor)<1e-12)continue;
        for(let j=col;j<=n;j++)a[row][j]-=factor*a[col][j];
      }
    }
    return a.map(row=>row[n]);
  }
  function homographyFromUnitSquare(corners,width,height){
    const points=[corners.topLeftCorner,corners.topRightCorner,corners.bottomRightCorner,corners.bottomLeftCorner],dest=[[0,0],[1,0],[1,1],[0,1]],matrix=[],vector=[];
    for(let i=0;i<4;i++){
      const [u,v]=dest[i],x=clamp(points[i].x/Math.max(1,width),0,1),y=clamp(points[i].y/Math.max(1,height),0,1);
      matrix.push([u,v,1,0,0,0,-x*u,-x*v]);vector.push(x);
      matrix.push([0,0,0,u,v,1,-y*u,-y*v]);vector.push(y);
    }
    return solveLinear(matrix,vector);
  }
  function weightedFit(points,independentKey,dependentKey){
    if(points.length<6)return null;
    let sw=0,sx=0,sy=0,sxx=0,sxy=0;
    for(const point of points){
      const weight=Math.max(1,point.weight||1),x=point[independentKey],y=point[dependentKey];
      sw+=weight;sx+=weight*x;sy+=weight*y;sxx+=weight*x*x;sxy+=weight*x*y;
    }
    const denominator=sw*sxx-sx*sx;
    if(Math.abs(denominator)<1e-6)return{a:0,b:sy/sw};
    const a=(sw*sxy-sx*sy)/denominator;
    return{a,b:(sy-a*sx)/sw};
  }
  function robustFit(points,independentKey,dependentKey){
    let fit=weightedFit(points,independentKey,dependentKey);
    if(!fit)return null;
    const residuals=points.map(point=>Math.abs(point[dependentKey]-(fit.a*point[independentKey]+fit.b))).sort((a,b)=>a-b);
    const cutoff=residuals[Math.min(residuals.length-1,Math.floor(residuals.length*.72))]||Infinity;
    return weightedFit(points.filter(point=>Math.abs(point[dependentKey]-(fit.a*point[independentKey]+fit.b))<=Math.max(2,cutoff)),independentKey,dependentKey)||fit;
  }
  function intersect(vertical,horizontal){
    if(!vertical||!horizontal)return null;
    const denominator=1-vertical.a*horizontal.a;
    if(Math.abs(denominator)<1e-6)return null;
    const x=(vertical.a*horizontal.b+vertical.b)/denominator;
    return{x,y:horizontal.a*x+horizontal.b};
  }
  function polygonArea(points){
    let sum=0;
    for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];sum+=a.x*b.y-b.x*a.y;}
    return Math.abs(sum)/2;
  }
  function quadPoints(corners){return[corners.topLeftCorner,corners.topRightCorner,corners.bottomRightCorner,corners.bottomLeftCorner];}
  function validQuad(corners,width,height){
    if(!corners)return false;
    const points=quadPoints(corners);
    if(points.some(point=>!Number.isFinite(point?.x)||!Number.isFinite(point?.y)))return false;
    if(points.some(point=>point.x<-width*.12||point.x>width*1.12||point.y<-height*.12||point.y>height*1.12))return false;
    if(polygonArea(points)<width*height*.18)return false;
    const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    return distance(points[0],points[1])>=width*.22&&distance(points[3],points[2])>=width*.22&&distance(points[0],points[3])>=height*.22&&distance(points[1],points[2])>=height*.22;
  }
  function buildGray(data,width,height){
    const gray=new Float32Array(width*height);
    for(let i=0,p=0;i<gray.length;i++,p+=4)gray[i]=data[p]*.299+data[p+1]*.587+data[p+2]*.114;
    return gray;
  }
  function buildGradient(gray,width,height){
    const edge=new Float32Array(width*height),histogram=new Uint32Array(256);
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      const tl=gray[(y-1)*width+x-1],tc=gray[(y-1)*width+x],tr=gray[(y-1)*width+x+1],ml=gray[y*width+x-1],mr=gray[y*width+x+1],bl=gray[(y+1)*width+x-1],bc=gray[(y+1)*width+x],br=gray[(y+1)*width+x+1];
      const gx=(tr+2*mr+br)-(tl+2*ml+bl),gy=(bl+2*bc+br)-(tl+2*tc+tr),m=Math.min(255,Math.hypot(gx,gy)/4);
      edge[y*width+x]=m;histogram[Math.round(m)]++;
    }
    let total=0;for(const value of histogram)total+=value;
    const target=total*.88;let cumulative=0,threshold=24;
    for(let i=0;i<256;i++){cumulative+=histogram[i];if(cumulative>=target){threshold=Math.max(24,i);break;}}
    return{edge,threshold};
  }
  function bandCandidate(gray,width,height){
    const at=(x,y)=>gray[y*width+x],left=[],right=[],top=[],bottom=[],minScore=18;
    for(let y=Math.max(2,Math.floor(height*.06));y<=Math.min(height-3,Math.ceil(height*.94));y+=2){
      let bestL={score:0,x:0},bestR={score:0,x:width-1};
      for(let x=2;x<Math.floor(width*.48);x++){const score=Math.abs(at(x+1,y)-at(x-1,y));if(score>bestL.score)bestL={score,x};}
      for(let x=Math.ceil(width*.52);x<width-2;x++){const score=Math.abs(at(x+1,y)-at(x-1,y));if(score>bestR.score)bestR={score,x};}
      if(bestL.score>=minScore)left.push({x:bestL.x,y,weight:bestL.score*bestL.score});
      if(bestR.score>=minScore)right.push({x:bestR.x,y,weight:bestR.score*bestR.score});
    }
    for(let x=Math.max(2,Math.floor(width*.06));x<=Math.min(width-3,Math.ceil(width*.94));x+=2){
      let bestT={score:0,y:0},bestB={score:0,y:height-1};
      for(let y=2;y<Math.floor(height*.48);y++){const score=Math.abs(at(x,y+1)-at(x,y-1));if(score>bestT.score)bestT={score,y};}
      for(let y=Math.ceil(height*.52);y<height-2;y++){const score=Math.abs(at(x,y+1)-at(x,y-1));if(score>bestB.score)bestB={score,y};}
      if(bestT.score>=minScore)top.push({x,y:bestT.y,weight:bestT.score*bestT.score});
      if(bestB.score>=minScore)bottom.push({x,y:bestB.y,weight:bestB.score*bestB.score});
    }
    const leftLine=robustFit(left,"y","x"),rightLine=robustFit(right,"y","x"),topLine=robustFit(top,"x","y"),bottomLine=robustFit(bottom,"x","y");
    return{topLeftCorner:intersect(leftLine,topLine),topRightCorner:intersect(rightLine,topLine),bottomRightCorner:intersect(rightLine,bottomLine),bottomLeftCorner:intersect(leftLine,bottomLine)};
  }
  function weightedExtreme(points,selector){
    if(points.length<24)return null;
    let best=-Infinity;
    for(const point of points)best=Math.max(best,selector(point));
    const tolerance=.075;let sx=0,sy=0,sw=0;
    for(const point of points){
      const score=selector(point);if(score<best-tolerance)continue;
      const closeness=1+(score-(best-tolerance))/tolerance,weight=Math.max(1,point.weight*point.weight)*closeness;
      sx+=point.x*weight;sy+=point.y*weight;sw+=weight;
    }
    return sw?{x:sx/sw,y:sy/sw}:null;
  }
  function extremeCandidate(edge,threshold,width,height){
    const points=[],margin=Math.max(2,Math.floor(Math.min(width,height)*.015));
    for(let y=margin;y<height-margin;y++)for(let x=margin;x<width-margin;x++){
      const weight=edge[y*width+x];if(weight<threshold)continue;
      points.push({x,y,weight,nx:x/Math.max(1,width-1),ny:y/Math.max(1,height-1)});
    }
    if(points.length<48)return null;
    return{
      topLeftCorner:weightedExtreme(points,p=>-(p.nx+p.ny)),
      topRightCorner:weightedExtreme(points,p=>p.nx-p.ny),
      bottomRightCorner:weightedExtreme(points,p=>p.nx+p.ny),
      bottomLeftCorner:weightedExtreme(points,p=>p.ny-p.nx)
    };
  }
  function edgeSupport(corners,edge,width,height){
    if(!validQuad(corners,width,height))return 0;
    const points=quadPoints(corners);let sum=0,count=0;
    for(let side=0;side<4;side++){
      const a=points[side],b=points[(side+1)%4];
      for(let step=0;step<=28;step++){
        const t=step/28,x=Math.round(a.x+(b.x-a.x)*t),y=Math.round(a.y+(b.y-a.y)*t);let best=0;
        for(let oy=-2;oy<=2;oy++)for(let ox=-2;ox<=2;ox++){
          const sx=x+ox,sy=y+oy;if(sx<0||sx>=width||sy<0||sy>=height)continue;
          best=Math.max(best,edge[sy*width+sx]);
        }
        sum+=best/255;count++;
      }
    }
    return count?sum/count:0;
  }
  function candidateScore(corners,edge,width,height){
    if(!validQuad(corners,width,height))return-1;
    const area=Math.min(.95,polygonArea(quadPoints(corners))/(width*height));
    return edgeSupport(corners,edge,width,height)+area*.12;
  }
  function detectDocumentCorners(imageData,width,height){
    const data=imageData?.data||imageData;
    if(!data||width<32||height<32||data.length<width*height*4)return null;
    const gray=buildGray(data,width,height),{edge,threshold}=buildGradient(gray,width,height),band=bandCandidate(gray,width,height),extreme=extremeCandidate(edge,threshold,width,height);
    const bandScore=candidateScore(band,edge,width,height),extremeScore=candidateScore(extreme,edge,width,height);
    const selected=extremeScore>bandScore+.015?extreme:band;
    return validQuad(selected,width,height)?selected:null;
  }
  window.WorklogScannerCore={homographyFromUnitSquare,detectDocumentCorners,validQuad};
})();
