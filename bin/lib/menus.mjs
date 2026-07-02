// menus.mjs — static menu/action data, extracted from hermit.mjs so it is
// importable and unit-testable without hermit.mjs's import-time side effects.
//
// These are pure data (only BRAND) + the pure action-lookup helpers that travel
// with them. State-coupled menu helpers (actionStateLabel / currentMenuStatusItems
// / visibleMenuRows) intentionally stay in hermit.mjs until currentFeatureStates()
// also moves out (usageState.mjs) — moving them now would create a circular import.
import { BRAND } from '../branding.mjs';

export const NAV_ACTIONS = [
  {
    id: 'web',
    label: '本地工作台',
    description: '两个本地入口：AgentCli 工作台=本机 Web daemon + 可视化工作台；飞书桥=把飞书 IM 接到本机 AgentCli，适合在群里调度 agent',
    recommended: true,
    children: [
      // 飞书 Codex 桥 — 推荐连接器，置顶；随 AgentCli 打包，菜单里开启即配置并启动。
      { id: 'toggle-feishu-bridge', label: '飞书 Codex 桥', toggle: 'feishu-bridge', description: '推荐连接器；完美适配飞书生态（群消息 → 本机 Codex / Claude Code），适合在 IM 里协作驱动 agent' },
      // AgentCli 工作台 — 启停本机 Web daemon，展示本地工作台访问地址。
      { id: 'toggle-web', label: 'AgentCli 工作台', toggle: 'web', description: '启动/停止本机 AgentCli Web 工作台；显示本地访问地址，用于团队、看板、运行时和用量的可视化管理' },
      { id: 'workbench-status', label: '查看本地工作台状态', description: '查看 AgentCli 工作台与飞书 Codex 桥 的运行状态' },
      { id: 'install-lark-cli', label: '快速安装 lark-cli' },
    ],
  },
  {
    id: 'data-sync',
    label: '用量同步',
    description: '回车展开；消息上报会启动后台增量扫描，首次补齐历史，后续只上传新增消息',
    children: [
      { id: 'toggle-message-upload', label: '消息上报', toggle: 'conversation-upload' },
      { id: 'overview', label: '查看同步状态' },
      { id: 'scan', label: '立即全量上报（慎选）', description: '若后台 worker 在运行，先暂停它；忽略游标全量重扫并重传历史（服务端按 eventId 去重，不会重复入库），完成后自动恢复 worker' },
      { id: 'upload-logs', label: '查看上报日志', developerOnly: true },
    ],
  },
  {
    id: 'account',
    label: '用户',
    description: '回车展开；登录、查看登录状态、退出登录',
    children: [
      { id: 'login', label: '登录 / OAuth 授权' },
      { id: 'status', label: '查看登录状态' },
      { id: 'logout', label: '退出登录' },
    ],
  },
  {
    id: 'aikey',
    label: 'token 池',
    description: '功能开发中，暂未开放',
    // comingSoon hides the children below and shows a notice on Enter instead of
    // expanding — the 认领/申请/状态 sub-actions aren't wired to a finished
    // backend yet. Remove the flag to re-expose them once token 池 ships.
    comingSoon: 'token 池仍在开发中，暂未开放，敬请期待。',
    children: [
      { id: 'aikey-claim', label: '认领 Claim' },
      { id: 'aikey-apply', label: '申请 Apply' },
      { id: 'aikey-status', label: '状态 Status' },
    ],
  },
  {
    id: 'exit',
    label: '退出',
    description: `离开 ${BRAND.stylizedName} 终端入口`,
  },
];

export const WEB_ENTRY_ACTIONS = [
  {
    id: 'start-web',
    label: '开启本地数字员工工作台',
    description: '启动本机工作台；不影响用量上报后台进程',
    recommended: true,
  },
  {
    id: 'stop-web',
    label: '关闭本地数字员工工作台',
    description: '停止本机工作台；不影响用量上报后台进程',
  },
  {
    id: 'back',
    label: '取消 / 返回首页',
    description: `不修改工作台状态，回到 ${BRAND.stylizedName} 入口`,
  },
];

export const SERVICE_ACTIONS = [
  {
    id: 'start-local',
    label: '启动本地基础服务',
    description: '启动 Web + Usage 后台采集 + 本地/自托管团队协作；无需登录，不上传',
    recommended: true,
  },
  {
    id: 'start-web',
    label: '只启动 Web 控制台',
    description: '启动本机 Web UI，不启动 usage worker',
  },
  {
    id: 'start-usage',
    label: '启动 Usage 后台采集',
    description: '轻量后台进程 + 默认开机自启；不上传',
  },
  {
    id: 'start-collaboration',
    label: '启用本地团队协作',
    description: '写入本地/自托管团队总线配置；不要求登录',
  },
  {
    id: 'status',
    label: '查看服务状态',
    description: '查看 Web daemon、usage worker 和本地协作状态',
  },
  {
    id: 'stop-usage',
    label: '停止 Usage 采集',
    description: '停止 usage worker 并关闭开机自启',
  },
  {
    id: 'stop-web',
    label: '停止 Web 控制台',
    description: '停止后台 daemon/runtime',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

export const LOCAL_USE_ACTIONS = [
  {
    id: 'web',
    label: '打开本机 Web 控制台',
    description: `进入本机 ${BRAND.stylizedName} Web，适合本地设置和可视化管理`,
  },
  {
    id: 'employees',
    label: '数字员工',
    description: '本机团队创建、列表和管理',
  },
  {
    id: 'local-collection',
    label: '本地数据采集',
    description: '查看本机 Loop 使用概览；无需登录，不依赖 Redis',
  },
  {
    id: 'runtime',
    label: '本地运行时',
    description: '后台服务状态、诊断和生命周期管理',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

export const TEAM_COLLAB_ACTIONS = [
  {
    id: 'open-web-settings',
    label: '打开协作设置',
    description: '进入 Web 设置 > 团队总线，管理 Redis 和协作配置',
  },
  {
    id: 'task-bus',
    label: '团队总线状态',
    description: '查看本地/自托管 Redis 和分布式协作状态',
  },
  {
    id: 'account',
    label: '用户状态',
    description: `查看或退出当前 ${BRAND.authAccountLabel}`,
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

export const EMPLOYEE_ACTIONS = [
  {
    id: 'create-team',
    label: '创建数字员工团队',
    description: '写入本地团队元数据',
  },
  {
    id: 'list-teams',
    label: '查看数字员工列表',
    description: '列出可见团队，隐藏已删除项',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

export const RUNTIME_ACTIONS = [
  {
    id: 'status',
    label: '服务状态',
    description: '查看 daemon / Web URL',
  },
  {
    id: 'doctor',
    label: '本地诊断',
    description: '只读检查配置与服务',
  },
  {
    id: 'stop',
    label: '停止后台服务',
    description: '结束后台 daemon/runtime',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

export const LOCAL_COLLECTION_ACTIONS = [
  {
    id: 'overview',
    label: '查看同步状态',
    description: '显示消息上报后台和本机扫描状态',
  },
  {
    id: 'scan',
    label: '立即全量上报（慎选）',
    description: '若后台 worker 在运行，先暂停它；忽略游标全量重扫并重传历史（服务端按 eventId 去重），完成后自动恢复 worker',
  },
  {
    id: 'choose-upload-provider',
    label: '开启消息上报',
    description: '默认同时扫描 Claude Code + Codex；按批次增量上传',
  },
  {
    id: 'stop-background',
    label: '停止消息上报',
    description: '停止消息上报 worker，并关闭开机自启',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

export const TASK_BUS_ACTIONS = [
  {
    id: 'status',
    label: '查看团队总线状态',
    description: '显示本地/自托管 Redis 和分布式协作状态',
  },
  {
    id: 'open-web-settings',
    label: '打开 Web 设置',
    description: '配置入口：设置 > 团队总线',
  },
  {
    id: 'doctor',
    label: '本地诊断',
    description: '只读检查服务和本地路径',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

export const ACCOUNT_ACTIONS = [
  {
    id: 'login',
    label: '登录 / OAuth 授权',
    description: '用于云端授权和托管服务；本地使用无需登录',
  },
  {
    id: 'status',
    label: '查看登录状态',
    description: `查看 ${BRAND.authAccountLabel} 授权状态`,
  },
  {
    id: 'logout',
    label: '退出登录',
    description: `退出 ${BRAND.authAccountLabel}，不影响本地 runtime 登录`,
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

export function findMenuAction(actions, actionId) {
  for (const action of actions) {
    if (action.id === actionId) return action;
    const child = action.children?.find((item) => item.id === actionId);
    if (child) return child;
  }
  return null;
}

export function menuFooterForEscape() {
  return '[↑↓/Ctrl-N/P 选择 · Enter 展开/确认 · ← 返回 · Esc 退出]';
}
