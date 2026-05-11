#!/usr/bin/env node
// Benchmark Windows process-table acquisition for the 1.5.5 perf fix.
//
// Measures the two tasklist code paths that replace the regressed PowerShell
// `Get-CimInstance Win32_Process` spawn loop:
//   1. `tasklist /v /fo csv /nh`            — full host process list (orphan sweep / OpenCode bridge)
//   2. `tasklist /fi "PID eq N" /fo csv /nh` — per-PID liveness check
//
// Run on Windows:
//   node scripts/benchmark-windows-process-table.mjs
//
// On Mac/Linux this exits early — POSIX systems use `ps` and were never the
// regression source.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

if (process.platform !== 'win32') {
  console.log('Skipping benchmark: this script only measures Windows process-table paths.');
  process.exit(0);
}

const ITERATIONS = Number.parseInt(process.env.ITERATIONS ?? '100', 10);
const PID_ITERATIONS = Number.parseInt(process.env.PID_ITERATIONS ?? '100', 10);
const TASKLIST = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'tasklist.exe'
);

function runTasklist(args, timeoutMs = 4_000) {
  return new Promise((resolve, reject) => {
    execFile(
      TASKLIST,
      args,
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(stdout ?? ''));
      }
    );
  });
}

function percentile(sortedSamples, p) {
  if (sortedSamples.length === 0) return Number.NaN;
  const idx = Math.min(sortedSamples.length - 1, Math.floor((p / 100) * sortedSamples.length));
  return sortedSamples[idx];
}

function report(label, samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((acc, v) => acc + v, 0) / samples.length;
  console.log(
    `${label.padEnd(28)} n=${samples.length}  mean=${mean.toFixed(0)}ms  ` +
      `p50=${percentile(sorted, 50).toFixed(0)}ms  ` +
      `p95=${percentile(sorted, 95).toFixed(0)}ms  ` +
      `p99=${percentile(sorted, 99).toFixed(0)}ms  ` +
      `max=${sorted[sorted.length - 1].toFixed(0)}ms`
  );
}

async function bench(label, fn, iterations) {
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    try {
      await fn();
    } catch (error) {
      console.warn(`${label}: iteration ${i} failed:`, error?.message ?? error);
    }
    samples.push(performance.now() - t0);
  }
  report(label, samples);
}

console.log(
  `Benchmark — Windows process probe (cold spawn, no caching) — ITERATIONS=${ITERATIONS}`
);
console.log('-'.repeat(80));

await bench('tasklist /v full list', () => runTasklist(['/v', '/fo', 'csv', '/nh']), ITERATIONS);
await bench(
  `tasklist /fi pid=${process.pid}`,
  () => runTasklist(['/fi', `PID eq ${process.pid}`, '/fo', 'csv', '/nh']),
  PID_ITERATIONS
);

console.log('-'.repeat(80));
console.log(
  'Acceptance targets:\n' +
    '  - Per-PID liveness  P95 ≤ 200ms (target ≤ 100ms)\n' +
    '  - Full list         P95 ≤ 500ms (only used for orphan sweep / OpenCode bridge)\n'
);
