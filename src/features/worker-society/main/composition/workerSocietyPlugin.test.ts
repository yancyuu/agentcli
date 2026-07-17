/**
 * workerSocietyPlugin —— 插件描述符单测（test-first）。
 *
 * 锁定：稳定 id、指向 hermit /mcp 的 HTTP-SSE 端点、工具列表与 SOCIETY_MCP_TOOLS 同源
 * （无漂移）、library 条目形状匹配 McpLibraryService.upsert 契约。
 */
import { describe, expect, it } from 'vitest';

import { SOCIETY_MCP_TOOLS } from '../adapters/input/societyMcp';

import {
  buildWorkerSocietyMcpLibraryEntry,
  WORKER_SOCIETY_PLUGIN,
  WORKER_SOCIETY_PLUGIN_ID,
} from './workerSocietyPlugin';

describe('WORKER_SOCIETY_PLUGIN descriptor', () => {
  it('has a stable plugin id matching the `agentcli add` key', () => {
    expect(WORKER_SOCIETY_PLUGIN_ID).toBe('worker-society');
    expect(WORKER_SOCIETY_PLUGIN.id).toBe('worker-society');
  });

  it('points at the hermit MCP HTTP-SSE endpoint', () => {
    expect(WORKER_SOCIETY_PLUGIN.kind).toBe('mcp-library');
    expect(WORKER_SOCIETY_PLUGIN.mcpEndpoint).toBe('/mcp');
    expect(WORKER_SOCIETY_PLUGIN.transportType).toBe('sse');
  });

  it('exposes the live society_* tool list with no drift vs SOCIETY_MCP_TOOLS', () => {
    expect(WORKER_SOCIETY_PLUGIN.tools).toEqual(SOCIETY_MCP_TOOLS.map((t) => t.name));
    expect(WORKER_SOCIETY_PLUGIN.tools.length).toBeGreaterThan(0);
    expect(WORKER_SOCIETY_PLUGIN.tools).toContain('society_register_worker');
    expect(WORKER_SOCIETY_PLUGIN.tools).toContain('society_run_autonomy_tick');
    expect(WORKER_SOCIETY_PLUGIN.tools).toContain('society_auto_select');
    expect(WORKER_SOCIETY_PLUGIN.tools.every((n) => n.startsWith('society_'))).toBe(true);
  });

  it('is plain serializable metadata (no functions, safe to log/POST)', () => {
    const json = JSON.parse(JSON.stringify(WORKER_SOCIETY_PLUGIN));
    expect(json.id).toBe('worker-society');
    expect(json.tools).toEqual(WORKER_SOCIETY_PLUGIN.tools);
  });
});

describe('buildWorkerSocietyMcpLibraryEntry', () => {
  it('defaults to 127.0.0.1:5680/mcp over SSE', () => {
    const entry = buildWorkerSocietyMcpLibraryEntry();
    expect(entry.name).toBe('worker-society');
    expect(entry.installSpec).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:5680/mcp',
      transportType: 'sse',
    });
  });

  it('respects custom host and port', () => {
    const entry = buildWorkerSocietyMcpLibraryEntry('0.0.0.0', 8080);
    expect(entry.installSpec.url).toBe('http://0.0.0.0:8080/mcp');
    expect(entry.installSpec.transportType).toBe('sse');
  });

  it('matches the McpLibraryService.upsert body shape', () => {
    const entry = buildWorkerSocietyMcpLibraryEntry();
    // upsert 期望：{ name, description?, installSpec: { type, url, transportType } }
    expect(typeof entry.name).toBe('string');
    expect(typeof entry.description).toBe('string');
    expect(entry.installSpec.type).toBe('http');
    expect(typeof entry.installSpec.url).toBe('string');
  });
});
