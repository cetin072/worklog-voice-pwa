import type { Config } from "@netlify/functions";
import { sendCurrentBriefing } from "../shared/kakao.mts";

export default async ()=>{
  try{
    const result=await sendCurrentBriefing({
      expectedPeriod:"오후 12시 30분",
      slot:"afternoon",
      requireFresh:true,
      automatic:true
    });
    console.log("Afternoon Kakao briefing",JSON.stringify(result));
  }catch(error){
    console.error("Afternoon Kakao briefing failed",String((error as any)?.message || "unknown").slice(0,120));
  }
};

export const config:Config={schedule:"45 3 * * *"};
