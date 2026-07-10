// restart.mjs — `agentcli restart`: cycle BOTH long-running layers so every
// process comes back on current code. This is the deterministic post-update
// command — `agentcli update` only hot-reloads the usage worker and never
// touches the web daemon, and `agentcli stop` is a no-op, so without this a
// stale web daemon / hermit-bridge / cc-connect can keep running old code.
//
// Order: usage worker down → web daemon (+ its hermit-bridge / cc-connect
// children) down → web daemon up → usage worker up. The web layer re-spawns its
// bridge children itself, so starting the daemon is enough to refresh them.
//
// Uses the LOW-LEVEL lifecycle (stopTelemetryWorker / startTelemetryWorker /
// stopDaemon / startDaemon) — never the settings-toggling services paths — so
// the user's telemetry.enabled / autostart preferences are preserved across the
// restart. A restart must not flip features off.
import { stopDaemon, startDaemon } from './daemon.mjs';
import { stopTelemetryWorker, startTelemetryWorker } from './usageCommand.mjs';
import { printCliRows } from './terminal.mjs';
import { port } from './env.mjs';
import { BRAND, brandCommand } from '../branding.mjs';

export async function runRestart({ quiet = false } = {}) {
  const url = `http://127.0.0.1:${port}`;

  // 1. usage worker down (kills process + pidfile only; settings untouched).
  await stopTelemetryWorker();
  // 2. web daemon + hermit-bridge + cc-connect down (port/command-pattern kill).
  await stopDaemon({ exitOnDone: false, quiet: true });
  // 3. web daemon back up. CRITICAL: explicit childArgs:[] — startDaemon
  //    otherwise defaults to process.argv.slice(2) ('restart'), and the spawned
  //    child re-enters bin/hermit.mjs with commandArgs=['restart'], looping
  //    forever. [] → no command → server-start fall-through.
  const daemon = startDaemon({ exitOnDone: false, quiet: true, childArgs: [] });
  // 4. usage worker back up on fresh code. forceRestart guarantees a new spawn
  //    even if a stop→start race left a stale pidfile behind.
  const worker = await startTelemetryWorker({ quiet: true, forceRestart: true });

  const result = {
    ok: true,
    command: 'restart',
    url,
    daemon,
    worker,
  };

  if (!quiet) {
    printCliRows(`${BRAND.stylizedName} 已重启`, [
      ['Web', daemon.started ? `已重启 (pid ${daemon.pid})` : `已在运行 (pid ${daemon.pid})`, 'ok'],
      ['地址', url, 'info'],
      ['用量 worker', worker.running ? `已重启 (pid ${worker.pid})` : '未启动', worker.running ? 'ok' : 'warn'],
    ], `两层均以当前代码重启。停止服务：${brandCommand('stop')} 之外的细粒度控制见 ${brandCommand('services')}。`);
  }
  return result;
}
