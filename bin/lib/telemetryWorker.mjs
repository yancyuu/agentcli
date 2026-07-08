// telemetryWorker.mjs — Worker spawning utilities used by both hermit.mjs
// (__telemetry-worker command entry) and usageCommand.mjs.
// Keeps the require() call isolated so other modules stay pure ESM.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { env } from 'node:process';
import { binDir } from './env.mjs';

const require = createRequire(import.meta.url);

export function telemetryWorkerChildArgs(extraArgs = []) {
  const tsxPath = pathToFileURL(require.resolve('tsx')).href;
  const aliasLoaderUrl = pathToFileURL(path.join(binDir, 'alias-loader.mjs')).href;
  const aliasLoader = `data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register(${JSON.stringify(aliasLoaderUrl)}, pathToFileURL("./"));`;
  return ['--import', aliasLoader, '--import', tsxPath, 'src/main/telemetry/worker.ts', ...extraArgs];
}
