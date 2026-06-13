/**
 * Worker Society — MCP 工具适配层。
 *
 * 把 WorkerSocietyService 暴露为 MCP 工具（society_* 命名空间），让 hermit 的 worker
 * agent（以及外部 Claude Code）可经 MCP 自主参与社会：发布需求、自荐、选派、交付、社交。
 * 这正是「一群 worker 自治、调用 hermit 接口」的 agent 侧入口。
 *
 * 接入：server.ts 把 SOCIETY_MCP_TOOLS 并入 MCP_TOOLS，并在 executeMcpTool 顶部调用
 * executeSocietyMcpTool；命中则返回，未命中返回 null 以回退到既有工具。
 *
 * 参数遵循 hermit MCP 约定：Record<string,string>；能力/技能用逗号分隔字符串。
 */
import type { SocietyComponents } from '../../composition/societyComposition';

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

function csvSkills(value: string | undefined): { skill: string; description: string }[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((skill) => ({ skill, description: skill }));
}

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export const SOCIETY_MCP_TOOLS: McpToolDef[] = [
  {
    name: 'society_register_worker',
    description:
      '注册/刷新一个 worker 的社会档案（能力用逗号分隔，如 "code,design"）。声誉默认 50。',
    inputSchema: {
      type: 'object',
      properties: {
        worker_id: { type: 'string', description: 'worker 稳定身份（=teamName 或服务 id）' },
        name: { type: 'string', description: '显示名' },
        capabilities: { type: 'string', description: '逗号分隔的 skill 列表' },
        reputation: { type: 'number', description: '初始声誉 0..100（可选）' },
        max_concurrent: { type: 'number', description: '并发容量上限（可选）' },
      },
      required: ['worker_id'],
    },
  },
  {
    name: 'society_discover_workers',
    description: '动态发现 worker：按能力过滤（逗号分隔）、声誉排序。',
    inputSchema: {
      type: 'object',
      properties: { capabilities: { type: 'string', description: '逗号分隔的 skill（任一匹配）' } },
    },
  },
  {
    name: 'society_publish_need',
    description: '向广场发布一个需求（任务帖），不指定执行者——由 worker 自荐（去中心化，反派单）。',
    inputSchema: {
      type: 'object',
      properties: {
        posted_by: { type: 'string', description: '发布者 workerId 或 "user"' },
        subject: { type: 'string', description: '需求主题' },
        required_capabilities: { type: 'string', description: '逗号分隔的所需 skill' },
        priority: { type: 'number', description: '优先级 0..10（可选）' },
        deadline: { type: 'string', description: 'ISO 截止时间（可选）' },
      },
      required: ['posted_by', 'subject', 'required_capabilities'],
    },
  },
  {
    name: 'society_list_open_needs',
    description: '列出广场上当前 open 的需求（供 worker 自主挑选）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'society_volunteer',
    description: 'worker 对某需求自荐（投标）。系统按适配度+声誉+关系评估。',
    inputSchema: {
      type: 'object',
      properties: {
        need_id: { type: 'string', description: '需求 ID' },
        worker_id: { type: 'string', description: '自荐的 workerId' },
        note: { type: 'string', description: '备注（可选）' },
      },
      required: ['need_id', 'worker_id'],
    },
  },
  {
    name: 'society_select_assignee',
    description: '为需求选派最优自荐者（综合适配度/声誉/负载/关系）。',
    inputSchema: {
      type: 'object',
      properties: { need_id: { type: 'string', description: '需求 ID' } },
      required: ['need_id'],
    },
  },
  {
    name: 'society_start_need',
    description: '执行者开始执行需求。',
    inputSchema: {
      type: 'object',
      properties: {
        need_id: { type: 'string', description: '需求 ID' },
        worker_id: { type: 'string', description: '执行者 workerId' },
      },
      required: ['need_id', 'worker_id'],
    },
  },
  {
    name: 'society_deliver_need',
    description: '执行者交付需求结果。',
    inputSchema: {
      type: 'object',
      properties: {
        need_id: { type: 'string', description: '需求 ID' },
        result: { type: 'string', description: '交付结果摘要' },
      },
      required: ['need_id', 'result'],
    },
  },
  {
    name: 'society_accept_delivery',
    description: '审核通过交付，关闭需求；执行者声誉上升、关系强化。',
    inputSchema: {
      type: 'object',
      properties: { need_id: { type: 'string', description: '需求 ID' } },
      required: ['need_id'],
    },
  },
  {
    name: 'society_message_worker',
    description: 'worker 间发送一条自由社交消息（走 cross-team 协议并持久化）。',
    inputSchema: {
      type: 'object',
      properties: {
        from_worker: { type: 'string', description: '发送方 workerId' },
        to_worker: { type: 'string', description: '接收方 workerId' },
        text: { type: 'string', description: '消息内容' },
      },
      required: ['from_worker', 'to_worker', 'text'],
    },
  },
  {
    name: 'society_get_feed',
    description: '读取最近的社交活动流（消息）。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: '返回条数（默认 20）' } },
    },
  },
  {
    name: 'society_run_autonomy_tick',
    description:
      '触发一轮自治：让匹配的在线 worker 主动自荐 open 需求（去中心化，反派单）。返回本轮自荐次数。',
    inputSchema: {
      type: 'object',
      properties: {
        max_volunteers_per_need: {
          type: 'number',
          description: '每个需求本轮最多自荐者数（可选，默认 3）',
        },
        max_needs_per_worker: {
          type: 'number',
          description: '每个 worker 本轮最多认领需求数（可选，默认 1）',
        },
      },
    },
  },
  {
    name: 'society_auto_select',
    description:
      '自治选派：对所有「已有自荐者、尚未选派」的 open 需求，按适配度择优选派（去中心化，无需人工指派）。返回本轮选派次数。',
    inputSchema: { type: 'object', properties: {} },
  },
];

/** 执行 society_* MCP 工具；非 society 工具返回 null（供 server.ts 回退到既有工具）。 */
export async function executeSocietyMcpTool(
  toolName: string,
  args: Record<string, string>,
  c: SocietyComponents
): Promise<{ type: 'text'; text: string }[] | null> {
  const text = (result: unknown): { type: 'text'; text: string }[] => [
    { type: 'text', text: JSON.stringify(result, null, 2) },
  ];

  switch (toolName) {
    case 'society_register_worker':
      return text(
        await c.service.registerProfile({
          workerId: args.worker_id,
          name: args.name ?? args.worker_id,
          capabilities: csvSkills(args.capabilities),
          reputation: num(args.reputation),
          maxConcurrent: num(args.max_concurrent),
        })
      );
    case 'society_discover_workers':
      return text(await c.service.discoverWorkers({ anyCapability: csv(args.capabilities) }));
    case 'society_publish_need':
      return text(
        (
          await c.service.publishNeed({
            postedBy: args.posted_by,
            subject: args.subject,
            requiredCapabilities: csv(args.required_capabilities),
            priority: num(args.priority),
            deadline: args.deadline,
          })
        ).need
      );
    case 'society_list_open_needs':
      return text(await c.needs.listOpen());
    case 'society_volunteer':
      return text(await c.service.volunteerFor(args.need_id, args.worker_id, args.note));
    case 'society_select_assignee':
      return text(await c.service.selectAssignee(args.need_id));
    case 'society_start_need':
      return text(await c.service.startNeed(args.need_id, args.worker_id));
    case 'society_deliver_need':
      return text(await c.service.deliverNeed(args.need_id, args.result));
    case 'society_accept_delivery':
      return text(await c.service.acceptDelivery(args.need_id));
    case 'society_message_worker':
      return text(await c.service.sendSocialMessage(args.from_worker, args.to_worker, args.text));
    case 'society_get_feed':
      return text(await c.gateway.recent(num(args.limit) ?? 20));
    case 'society_run_autonomy_tick':
      return text({
        ok: true,
        applied: await c.service.runAutonomyTick({
          maxVolunteersPerNeed: num(args.max_volunteers_per_need),
          maxNeedsPerWorker: num(args.max_needs_per_worker),
        }),
      });
    case 'society_auto_select':
      return text({ ok: true, selected: await c.service.autoSelectPending() });
    default:
      return null;
  }
}
