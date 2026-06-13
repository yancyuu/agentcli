/**
 * societyDemo — 一键示例社会播种数据（冷启动 / 演示用）。
 *
 * buildDemoSociety() 返回固定、能力可互配的 workers + needs，让 worker-society 无需
 * 手工逐个注册即可演示完整自治闭环：注册 → 发布 → 触发自治（自荐→择优选派）→
 * 执行 → 交付 → 审核 → 声誉/关系累积。
 *
 * 纯函数、确定性：无 Math.random / 无 FS / 无 network —— 完全可单测。
 * 关键不变量（见 societyDemo.test.ts）：每个 need 的能力都至少被一个 worker 单独覆盖，
 * 否则自治选派会落空，演示即失败。
 */
import type { PublishNeedInput, RegisterWorkerInput } from './societyApi';

export interface DemoSociety {
  workers: RegisterWorkerInput[];
  needs: PublishNeedInput[];
}

/**
 * 固定示例：3 个 worker（前端 / 后端 / 评审）+ 2 个 need（UI 实现 / API 评审测试）。
 * 能力刻意重叠，保证「触发自治」能匹配并择优选派。
 */
export function buildDemoSociety(): DemoSociety {
  return {
    workers: [
      {
        workerId: 'frontend',
        name: '前端工程师',
        capabilities: 'react,css,ui',
        reputation: 72,
        maxConcurrent: 2,
      },
      {
        workerId: 'backend',
        name: '后端工程师',
        capabilities: 'node,sql,api',
        reputation: 68,
        maxConcurrent: 2,
      },
      {
        workerId: 'reviewer',
        name: '评审工程师',
        capabilities: 'review,test,node',
        reputation: 80,
        maxConcurrent: 1,
      },
    ],
    needs: [
      {
        postedBy: 'user',
        subject: '实现登录页面 UI',
        requiredCapabilities: 'react,css',
        priority: 8,
      },
      {
        postedBy: 'user',
        subject: '评审并测试用户 API',
        requiredCapabilities: 'node,review',
        priority: 6,
      },
    ],
  };
}
