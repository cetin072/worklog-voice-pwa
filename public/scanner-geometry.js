(()=>{
  const EDGE_KEYS={
    top:["topLeftCorner","topRightCorner"],
    right:["topRightCorner","bottomRightCorner"],
    bottom:["bottomLeftCorner","bottomRightCorner"],
    left:["topLeftCorner","bottomLeftCorner"]
  };
  const copyCorners=value=>Object.fromEntries(Object.entries(value).map(([key,point])=>[key,{x:point.x,y:point.y}]));
  function pointSegmentDistance(point,a,b){
    const dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
    if(!length2)return Math.hypot(point.x-a.x,point.y-a.y);
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length2));
    return Math.hypot(point.x-(a.x+dx*t),point.y-(a.y+dy*t));
  }
  function nearestEdge(corners,point,maxDistance){
    let best=null,bestDistance=Infinity;
    for(const [name,[aKey,bKey]] of Object.entries(EDGE_KEYS)){
      const distance=pointSegmentDistance(point,corners[aKey],corners[bKey]);
      if(distance<bestDistance){best=name;bestDistance=distance;}
    }
    return bestDistance<=maxDistance?best:null;
  }
  function clampShift(origin,aKey,bKey,nx,ny,shift,width,height){
    let min=-Infinity,max=Infinity;
    for(const key of [aKey,bKey]){
      const point=origin[key];
      if(Math.abs(nx)>1e-9){
        const low=(0-point.x)/nx,high=(width-point.x)/nx;
        min=Math.max(min,Math.min(low,high));max=Math.min(max,Math.max(low,high));
      }
      if(Math.abs(ny)>1e-9){
        const low=(0-point.y)/ny,high=(height-point.y)/ny;
        min=Math.max(min,Math.min(low,high));max=Math.min(max,Math.max(low,high));
      }
    }
    return Math.max(min,Math.min(max,shift));
  }
  function moveEdge(origin,edgeName,dx,dy,width,height){
    const keys=EDGE_KEYS[edgeName];
    if(!keys)return copyCorners(origin);
    const [aKey,bKey]=keys,a=origin[aKey],b=origin[bKey],ex=b.x-a.x,ey=b.y-a.y,length=Math.hypot(ex,ey)||1;
    const nx=-ey/length,ny=ex/length;
    let shift=dx*nx+dy*ny;
    shift=clampShift(origin,aKey,bKey,nx,ny,shift,width,height);
    const next=copyCorners(origin);
    next[aKey]={x:a.x+nx*shift,y:a.y+ny*shift};
    next[bKey]={x:b.x+nx*shift,y:b.y+ny*shift};
    return next;
  }
  function edgeMidpoints(corners){
    const result={};
    for(const [name,[aKey,bKey]] of Object.entries(EDGE_KEYS)){
      const a=corners[aKey],b=corners[bKey];
      result[name]={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    }
    return result;
  }
  window.WorklogScannerGeometry={nearestEdge,moveEdge,edgeMidpoints};
})();
