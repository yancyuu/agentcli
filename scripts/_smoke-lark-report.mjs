// ad-hoc smoke: run the exact wire payload the worker.ts reporter will POST,
// and (optionally) actually POST it once so we can verify the round-trip.
//
// Usage:  node scripts/_smoke-lark-report.mjs           // print payload only
//         node scripts/_smoke-lark-report.mjs --report  // also POST

const { runLarkCredentialsCommand } = await import('../bin/lib/larkSecrets.mjs');

const wantsReport = process.argv.includes('--report');
const wantsJson = !wantsReport; // local-print path is `--json`; report path prints row.

await runLarkCredentialsCommand({ report: wantsReport, json: wantsJson });