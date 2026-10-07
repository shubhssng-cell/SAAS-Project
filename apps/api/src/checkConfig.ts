import { evaluateProductionConfig, formatReport } from "./productionConfig.js";

/**
 * `npm run check:config --workspace @ipmat/api` -- prints the production-readiness report for the CURRENT environment (setting names and
 * fixed explanations only; never a value) and exits 1 if a production start would be refused. It connects to nothing.
 * Run it with the same environment the deployment will have (and NODE_ENV=production) before deploying.
 */
const report = evaluateProductionConfig(process.env);
console.log(formatReport(report));
process.exit(report.ok ? 0 : 1);
