import type { Config } from "@netlify/functions";
import { createRegionProbeHandler } from "../shared/perf-region-probe.mjs";

export default createRegionProbeHandler("cmh");

export const config:Config={
  path:"/api/perf-region-cmh",
  region:"cmh"
};
