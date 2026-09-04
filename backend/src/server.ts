import "./instrument.js"; // must load before anything else — see Sentry's Node SDK setup docs

import { app, installProcessCrashGuards } from "./app.js";
import { startDigestScheduler } from "./modules/push/digestScheduler.js";
import { startRouteMetricsFlush } from "./lib/routeMetrics.js";

installProcessCrashGuards();
startDigestScheduler();
startRouteMetricsFlush();

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`Rupee Radar AI API listening on :${port}`);
});
