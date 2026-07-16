#!/usr/bin/env node

import { reportAllLarkCredentials } from '../bin/lib/larkSecrets.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage: pnpm lark:report-once

Refresh every eligible lark-cli personal as-user authorization, upload the
resulting credentials to AgentBus once, print a redacted JSON status, and exit.`);
  process.exit(0);
}

const result = await reportAllLarkCredentials();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
