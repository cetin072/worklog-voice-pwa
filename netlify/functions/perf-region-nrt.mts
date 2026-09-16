import type { Config } from "@netlify/functions";
import { createRegionProbeHandler } from "../shared/perf-region-probe.mjs";

export default createRegionProbeHandler("nrt");

export const config:Config={
  path:"/api/perf-region-nrt",
  region:"nrt"
};
