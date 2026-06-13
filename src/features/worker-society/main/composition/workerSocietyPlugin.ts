/**
 * workerSocietyPlugin —— 把 worker-society 声明为 hermit 的「可安装插件」。
 *
 * 关键事实：hermit 自己就是 MCP-over-HTTP-SSE 服务端（`GET/POST /mcp`），society_*
 * 工具已经通过该端点对外暴露（server.ts 把 SOCIETY_MCP_TOOLS 接进 /mcp 分发）。
 * 所以「安装 worker 社会」最贴合 hermit 架构的做法 = 把这个端点注册进 hermit 的
 * MCP library（`~/.hermit/mcp-library.json`），用户的 coding agent（Claude Code 等）
 * 即可获得 society_* 工具，参与去中心化自治社会。这正是 hermit「定义一次、给任意
 * worker 启用」的 MCP 安装模型（见 McpLibraryService）。
 *
 * 纯描述符 + 构造器，无副作用，便于单测；`openhermit add worker-society` 据此生成
 * MCP library 条目并 POST 到 `/api/extensions/mcp/library`。
 */
import { SOCIETY_MCP_TOOLS } from '../adapters/input/societyMcp';

/** 稳定插件 id，也是 `openhermit add <id>` 的键。 */
export const WORKER_SOCIETY_PLUGIN_ID = 'worker-society';

export interface WorkerSocietyPluginDescriptor {
  /** 稳定插件 id。 */
  id: string;
  name: string;
  description: string;
  /** 安装种类：注册为 MCP library 条目（HTTP-SSE 服务端）。 */
  kind: 'mcp-library';
  /** society 对外暴露的 MCP 端点路径（挂在 hermit 主服务上）。 */
  mcpEndpoint: string;
  /** MCP 传输类型：HTTP-SSE。 */
  transportType: 'sse';
  /** 该插件给 agent 带来的 MCP 工具名列表（实时取自 SOCIETY_MCP_TOOLS，避免漂移）。 */
  tools: string[];
}

/** worker-society 的插件描述符（纯数据）。 */
export const WORKER_SOCIETY_PLUGIN: WorkerSocietyPluginDescriptor = {
  id: WORKER_SOCIETY_PLUGIN_ID,
  name: 'worker-society',
  description:
    '去中心化 worker 自治社会：agent 通过 society_* 工具发布需求、自荐、择优选派、积累声誉与关系，替代中心化派单。',
  kind: 'mcp-library',
  mcpEndpoint: '/mcp',
  transportType: 'sse',
  tools: SOCIETY_MCP_TOOLS.map((t) => t.name),
};

/**
 * 构造注册进 MCP library 所需的条目（指向某 host:port 上运行中的 hermit /mcp）。
 * 形状匹配 McpLibraryService.upsert 的 McpLibraryUpsertRequest（不含 id → 新建）。
 */
export function buildWorkerSocietyMcpLibraryEntry(
  host = '127.0.0.1',
  port = 5680
): {
  name: string;
  description: string;
  installSpec: { type: 'http'; url: string; transportType: 'sse' };
} {
  return {
    name: WORKER_SOCIETY_PLUGIN.name,
    description: WORKER_SOCIETY_PLUGIN.description,
    installSpec: {
      type: 'http',
      url: `http://${host}:${port}${WORKER_SOCIETY_PLUGIN.mcpEndpoint}`,
      transportType: WORKER_SOCIETY_PLUGIN.transportType,
    },
  };
}
