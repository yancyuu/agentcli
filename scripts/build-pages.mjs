import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, '_site');

function writeText(relativePath, content) {
  const target = join(OUT_DIR, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content.trimStart(), 'utf8');
}

function copyFile(fromRelative, toRelative = fromRelative) {
  const source = join(ROOT, fromRelative);
  if (!existsSync(source)) return;
  const target = join(OUT_DIR, toRelative);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>openHermit — AI 工程协作平台</title>
  <meta name="description" content="本地优先的 AI 编程工具用量采集与团队协作平台。自动监控 Claude Code、Codex、Cursor 等工具消耗，上报至 Hermit Bus。" />
  <meta property="og:title" content="openHermit" />
  <meta property="og:description" content="本地优先的 AI 工程协作平台。采集 → 上报 → 协作。" />
  <meta property="og:type" content="website" />
  <link rel="icon" href="icon.png" />
  <style>
    :root {
      --bg: #090A0B;
      --bg-card: #111113;
      --border: #27272a;
      --text: #e4e4e7;
      --text-muted: #a1a1aa;
      --text-dim: #71717a;
      --accent: #8B5CF6;
      --accent-light: #a78bfa;
      --green: #22c55e;
      color-scheme: dark;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    a { color: var(--accent-light); text-decoration: none; }
    a:hover { text-decoration: underline; }

    .header {
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      max-width: 1200px;
      margin: 0 auto;
    }
    .header-logo {
      font-size: 20px;
      font-weight: 700;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .header-logo img { width: 28px; height: 28px; border-radius: 6px; }
    .header-nav { display: flex; gap: 24px; align-items: center; }
    .header-nav a { color: var(--text-muted); font-size: 14px; }
    .header-nav a:hover { color: var(--text); text-decoration: none; }

    .hero {
      text-align: center;
      padding: 80px 24px 60px;
      max-width: 800px;
      margin: 0 auto;
    }
    .hero-badge {
      display: inline-block;
      background: rgba(139, 92, 246, 0.1);
      border: 1px solid rgba(139, 92, 246, 0.3);
      border-radius: 999px;
      padding: 4px 14px;
      font-size: 13px;
      color: var(--accent-light);
      margin-bottom: 24px;
    }
    .hero h1 {
      font-size: clamp(36px, 6vw, 64px);
      font-weight: 800;
      line-height: 1.1;
      margin-bottom: 16px;
      background: linear-gradient(135deg, var(--text) 0%, var(--accent-light) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .hero p {
      font-size: 18px;
      color: var(--text-muted);
      max-width: 640px;
      margin: 0 auto 32px;
    }

    .install-box {
      max-width: 640px;
      margin: 0 auto;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    .install-tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
    }
    .install-tab {
      flex: 1;
      padding: 10px 16px;
      font-size: 13px;
      color: var(--text-muted);
      text-align: center;
      cursor: pointer;
      border: none;
      background: none;
      transition: color 0.2s, background 0.2s;
    }
    .install-tab.active {
      color: var(--accent-light);
      background: rgba(139, 92, 246, 0.05);
      border-bottom: 2px solid var(--accent);
    }
    .install-content { display: none; padding: 20px 24px; }
    .install-content.active { display: block; }
    .install-cmd {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 14px;
      color: var(--green);
      word-break: break-all;
      user-select: all;
    }
    .install-cmd .comment { color: var(--text-dim); }

    .arch-section {
      max-width: 800px;
      margin: 0 auto;
      padding: 60px 24px;
      text-align: center;
    }
    .arch-section h2 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 32px;
    }
    .arch-diagram {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 32px 24px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 14px;
      line-height: 2;
      color: var(--text-muted);
      text-align: left;
      overflow-x: auto;
    }
    .arch-diagram .highlight { color: var(--accent-light); }
    .arch-diagram .dim { color: var(--text-dim); }

    .features-section {
      max-width: 1200px;
      margin: 0 auto;
      padding: 60px 24px;
    }
    .features-header {
      text-align: center;
      margin-bottom: 48px;
    }
    .features-header h2 {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .features-header p {
      color: var(--text-muted);
      font-size: 16px;
    }
    .features-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 20px;
    }
    .feature-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 28px 24px;
      transition: border-color 0.2s;
    }
    .feature-card:hover { border-color: var(--accent); }
    .feature-icon {
      width: 40px;
      height: 40px;
      background: rgba(139, 92, 246, 0.1);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      font-size: 20px;
    }
    .feature-card h3 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .feature-card p {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.5;
    }

    .runtimes-section {
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 24px 60px;
      text-align: center;
    }
    .runtimes-section h2 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 20px;
    }
    .runtime-tags {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
    }
    .runtime-tag {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 8px 16px;
      font-size: 13px;
      color: var(--text-muted);
    }

    .footer {
      border-top: 1px solid var(--border);
      padding: 40px 24px;
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .footer-left { color: var(--text-dim); font-size: 13px; }
    .footer-links { display: flex; gap: 20px; }
    .footer-links a { color: var(--text-muted); font-size: 13px; }

    @media (max-width: 640px) {
      .header { flex-direction: column; gap: 12px; }
      .hero { padding: 48px 16px 40px; }
      .features-grid { grid-template-columns: 1fr; }
      .footer { flex-direction: column; text-align: center; }
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-logo">
      <img src="icon.png" alt="openHermit" />
      openHermit
    </div>
    <nav class="header-nav">
      <a href="https://github.com/yancyuu/Hermit">GitHub</a>
      <a href="https://www.npmjs.com/package/@yancyyu/openhermit">npm</a>
      <a href="https://github.com/yancyuu/Hermit#readme">文档</a>
    </nav>
  </header>

  <section class="hero">
    <span class="hero-badge">Local-first &middot; Open Source</span>
    <h1>openHermit</h1>
    <p>本地优先的 AI 工程协作平台。自动采集 AI 编程工具用量，上报至 Hermit Bus，面向企业提供用量看板与团队协作能力。</p>

    <div class="install-box">
      <div class="install-tabs">
        <button class="install-tab active" data-target="tab-curl">macOS / Linux</button>
        <button class="install-tab" data-target="tab-npm">npm</button>
        <button class="install-tab" data-target="tab-npx">npx (免安装)</button>
      </div>
      <div class="install-content active" id="tab-curl">
        <div class="install-cmd">curl -fsSL https://yancyuu.github.io/Hermit/install.sh | bash</div>
      </div>
      <div class="install-content" id="tab-npm">
        <div class="install-cmd">npm install -g @yancyyu/openhermit</div>
      </div>
      <div class="install-content" id="tab-npx">
        <div class="install-cmd"><span class="comment"># 无需安装，直接运行</span><br/>npx @yancyyu/openhermit</div>
      </div>
    </div>
  </section>

  <section class="arch-section">
    <h2>架构</h2>
    <div class="arch-diagram">
      <span class="dim">开发者本地</span><br/>
      <span class="highlight">Claude Code / Codex / Cursor / Gemini / OpenCode ...</span><br/>
      &nbsp;&nbsp;&nbsp;&nbsp;&#8595; 会话日志 &amp; token 用量<br/>
      <span class="highlight">openHermit</span> <span class="dim">(本地采集 &amp; Web 工作台)</span><br/>
      &nbsp;&nbsp;&nbsp;&nbsp;&#8595; 统一上报<br/>
      <span class="highlight">Hermit Bus</span> <span class="dim">(中心化服务端 &middot; 数据总线)</span><br/>
      &nbsp;&nbsp;&nbsp;&nbsp;&#8595; 看板 &amp; 协作<br/>
      <span class="dim">企业管理者 / 团队成员</span>
    </div>
  </section>

  <section class="features-section">
    <div class="features-header">
      <h2>核心能力</h2>
      <p>从用量可见到团队协作</p>
    </div>
    <div class="features-grid">
      <div class="feature-card">
        <div class="feature-icon">&#9881;</div>
        <h3>自动采集</h3>
        <p>无侵入式扫描本地 AI Agent 会话日志，自动识别 token 消耗、会话数、消息量，零配置开箱即用。</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#8644;</div>
        <h3>统一上报</h3>
        <p>多运行时、多场景通过同一个接口汇总至 Hermit Bus。支持断点续传、幂等去重、背压控制。</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#128202;</div>
        <h3>企业看板</h3>
        <p>按团队、成员、工具、场景维度展示 token 用量和会话活跃度。企业管理者一目了然。</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#128101;</div>
        <h3>团队协作</h3>
        <p>数字员工 IM 消息路由、跨团队任务派发、多 Agent 编排。让 AI 编程从单兵走向团队化。</p>
      </div>
    </div>
  </section>

  <section class="runtimes-section">
    <h2>支持的 AI 编程工具</h2>
    <div class="runtime-tags">
      <span class="runtime-tag">Claude Code</span>
      <span class="runtime-tag">Codex</span>
      <span class="runtime-tag">Cursor</span>
      <span class="runtime-tag">Gemini CLI</span>
      <span class="runtime-tag">OpenCode</span>
      <span class="runtime-tag">Kimi</span>
      <span class="runtime-tag">Devin</span>
      <span class="runtime-tag">Qoder</span>
    </div>
  </section>

  <footer class="footer">
    <div class="footer-left">&copy; 2026 openHermit. AGPL-3.0 License.</div>
    <div class="footer-links">
      <a href="https://github.com/yancyuu/Hermit">GitHub</a>
      <a href="https://www.npmjs.com/package/@yancyyu/openhermit">npm</a>
      <a href="https://github.com/yancyuu/Hermit/issues">反馈</a>
    </div>
  </footer>

  <script>
    document.querySelectorAll('.install-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.install-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.install-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.target).classList.add('active');
      });
    });
  </script>
</body>
</html>
`;

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
writeText('index.html', html);
copyFile('scripts/install.sh', 'install.sh');
copyFile('public/icon.png', 'icon.png');

console.log(`Built GitHub Pages site at ${OUT_DIR}`);
console.log('- index.html');
console.log('- install.sh');
console.log('- icon.png');
