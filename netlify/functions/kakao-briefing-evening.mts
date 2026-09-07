import type { Config } from "@netlify/functions";
import { sendCurrentBriefing } from "../shared/kakao.mts";

export default async ()=>{
  try{
    const result=await sendCurrentBriefing({
      expectedPeriod:"오후 6시",
      slot:"evening",
      requireFresh:true,
      automatic:true
    });
    console.log("Evening Kakao briefing",JSON.stringify(result));
  }catch(error){
    console.error("Evening Kakao briefing failed",String((error as any)?.message || "unknown").slice(0,120));
  }
};

export const config:Config={schedule:"15 9 * * *"};
