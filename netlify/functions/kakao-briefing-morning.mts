import type { Config } from "@netlify/functions";
import { sendCurrentBriefing } from "../shared/kakao.mts";

export default async ()=>{
  try{
    const result=await sendCurrentBriefing({
      expectedPeriod:"오전 8시",
      slot:"morning",
      requireFresh:true,
      automatic:true
    });
    console.log("Morning Kakao briefing",JSON.stringify(result));
  }catch(error){
    console.error("Morning Kakao briefing failed",String((error as any)?.message || "unknown").slice(0,120));
  }
};

export const config:Config={schedule:"15 23 * * *"};
