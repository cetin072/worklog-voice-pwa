export function createRegionProbeHandler(label){
  return async function regionProbe(_req,context){
    const started=performance.now();
    const supabaseUrl=Netlify.env.get("SUPABASE_URL");
    if(!supabaseUrl){
      return new Response(JSON.stringify({ok:false,error:"SUPABASE_URL missing"}),{
        status:503,
        headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
      });
    }

    const upstreamStarted=performance.now();
    let status=0;
    let upstreamOk=false;
    try{
      const response=await fetch(`${supabaseUrl.replace(/\/$/,"")}/auth/v1/health`,{
        method:"GET",
        headers:{accept:"application/json"},
        cache:"no-store"
      });
      status=response.status;
      upstreamOk=response.ok;
      await response.text();
    }catch(error){
      return new Response(JSON.stringify({
        ok:false,
        label,
        serverRegion:String(context?.server?.region || "unknown"),
        error:"upstream_fetch_failed",
        message:String(error?.message || "unknown").slice(0,120),
        upstreamMs:Number((performance.now()-upstreamStarted).toFixed(1)),
        totalMs:Number((performance.now()-started).toFixed(1))
      }),{
        status:502,
        headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
      });
    }

    return new Response(JSON.stringify({
      ok:true,
      label,
      serverRegion:String(context?.server?.region || "unknown"),
      upstreamStatus:status,
      upstreamOk,
      upstreamMs:Number((performance.now()-upstreamStarted).toFixed(1)),
      totalMs:Number((performance.now()-started).toFixed(1))
    }),{
      status:200,
      headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
    });
  };
}
