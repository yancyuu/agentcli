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
  <title>AgentCli — AI 工程协作平台</title>
  <meta name="description" content="本地优先的 AI 编程工具用量采集与团队协作平台。自动监控 Claude Code、Codex、Cursor 等工具消耗，上报至 AgentBus。" />
  <meta property="og:title" content="AgentCli" />
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
      <img src="icon.png" alt="AgentCli" />
      AgentCli
    </div>
    <nav class="header-nav">
      <a href="guide.html">使用指南</a>
    </nav>
  </header>

  <section class="hero">
    <span class="hero-badge">Local-first &middot; Open Source</span>
    <h1>AgentCli</h1>
    <p>本地优先的 AI 工程协作平台。自动采集 AI 编程工具用量，上报至 AgentBus，面向企业提供用量看板与团队协作能力。</p>

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
      <span class="highlight">AgentCli</span> <span class="dim">(本地采集 &amp; Web 工作台)</span><br/>
      &nbsp;&nbsp;&nbsp;&nbsp;&#8595; 统一上报<br/>
      <span class="highlight">AgentBus</span> <span class="dim">(中心化服务端 &middot; 数据总线)</span><br/>
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
        <p>多运行时、多场景通过同一个接口汇总至 AgentBus。支持断点续传、幂等去重、背压控制。</p>
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
    <div class="footer-left">&copy; 2026 AgentCli. AGPL-3.0 License.</div>
    <div class="footer-links">
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

const guideHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AgentCli 使用指南</title>
  <meta name="description" content="AgentCli 完整使用指南：安装、命令参考、用量上报、常见问题排查。" />
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
      --red: #ef4444;
      --yellow: #eab308;
      color-scheme: dark;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.7;
      -webkit-font-smoothing: antialiased;
    }
    a { color: var(--accent-light); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 0.9em;
    }
    pre {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 14px;
      line-height: 1.6;
      margin: 12px 0;
    }
    pre code { background: none; border: none; padding: 0; }

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

    .container {
      max-width: 860px;
      margin: 0 auto;
      padding: 48px 24px 80px;
    }
    .container h1 {
      font-size: 36px;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .container .subtitle {
      color: var(--text-muted);
      font-size: 16px;
      margin-bottom: 48px;
    }
    .container h2 {
      font-size: 24px;
      font-weight: 700;
      margin: 48px 0 16px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
    }
    .container h2:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
    .container h3 {
      font-size: 18px;
      font-weight: 600;
      margin: 28px 0 12px;
    }
    .container p { margin: 12px 0; }
    .container ul, .container ol { margin: 12px 0; padding-left: 24px; }
    .container li { margin: 6px 0; }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 14px;
    }
    th, td {
      text-align: left;
      padding: 10px 14px;
      border: 1px solid var(--border);
    }
    th {
      background: var(--bg-card);
      font-weight: 600;
      white-space: nowrap;
    }
    td code { font-size: 0.85em; }

    .callout {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-left: 4px solid var(--accent);
      border-radius: 8px;
      padding: 16px 20px;
      margin: 16px 0;
    }
    .callout.warn { border-left-color: var(--yellow); }
    .callout.error { border-left-color: var(--red); }
    .callout.success { border-left-color: var(--green); }
    .callout-title {
      font-weight: 600;
      margin-bottom: 8px;
      font-size: 14px;
    }

    .toc {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px 28px;
      margin-bottom: 48px;
    }
    .toc h3 { margin: 0 0 12px; font-size: 16px; }
    .toc ul { list-style: none; padding: 0; }
    .toc li { margin: 6px 0; }
    .toc a { font-size: 14px; }

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
      .container { padding: 32px 16px 60px; }
      .container h1 { font-size: 28px; }
      .footer { flex-direction: column; text-align: center; }
    }
  </style>
</head>
<body>
  <header class="header">
    <a class="header-logo" href="./">
      <img src="icon.png" alt="AgentCli" />
      AgentCli
    </a>
    <nav class="header-nav">
      <a href="./">首页</a>
    </nav>
  </header>

  <div class="container">
    <h1>AgentCli 使用指南</h1>
    <p class="subtitle">安装、命令参考、用量上报、常见问题</p>

    <div class="toc">
      <h3>目录</h3>
      <ul>
        <li><a href="#install">1. 安装</a></li>
        <li><a href="#cli-ref">2. CLI 命令参考</a></li>
        <li><a href="#first-use">3. 首次使用流程</a></li>
        <li><a href="#usage-report">4. 用量上报</a></li>
        <li><a href="#faq">5. 常见问题</a></li>
      </ul>
    </div>

    <h2 id="install">1. 安装</h2>

    <h3>方式一：一键安装脚本（推荐）</h3>
    <pre><code>curl -fsSL https://yancyuu.github.io/Hermit/install.sh | bash</code></pre>
    <p>脚本会自动检测系统环境，如果没有 Node.js 会自动安装。支持 macOS 和 Linux。</p>

    <h3>方式二：npm 全局安装</h3>
    <pre><code>npm install -g @yancyyu/openhermit@latest --prefer-online
openhermit</code></pre>

    <h3>方式三：npx 免安装运行</h3>
    <pre><code>npx @yancyyu/openhermit@latest</code></pre>

    <div class="callout">
      <div class="callout-title">前置要求</div>
      <ul>
        <li>Node.js 18+（安装脚本会自动处理）</li>
        <li>能访问 npm registry（或配置了企业内网镜像）</li>
        <li>需要执行任务时，本机需安装并登录对应 Agent CLI（如 Claude Code、Codex 等）</li>
      </ul>
    </div>

    <h2 id="cli-ref">2. CLI 命令参考</h2>

    <table>
      <thead>
        <tr><th>命令</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr><td><code>openhermit</code></td><td>启动终端导航器（交互式菜单）— 本地使用、团队管理、账户设置</td></tr>
        <tr><td><code>openhermit web</code></td><td>启动并直接在浏览器打开 Web 工作台</td></tr>
        <tr><td><code>openhermit --daemon</code></td><td>后台运行工作台（不阻塞终端）</td></tr>
        <tr><td><code>openhermit status</code></td><td>查看后台 daemon 运行状态</td></tr>
        <tr><td><code>openhermit stop</code></td><td>停止后台 daemon</td></tr>
        <tr><td><code>openhermit --port 8080</code></td><td>指定 Web UI 监听端口（默认 5680）</td></tr>
        <tr><td><code>openhermit --version</code></td><td>打印当前版本号</td></tr>
        <tr><td><code>openhermit update</code></td><td>自更新到最新版本</td></tr>
      </tbody>
    </table>

    <div class="callout">
      <div class="callout-title">提示</div>
      <p><code>openhermit</code> 不带参数会进入终端导航器（控制面菜单）。如果只想打开浏览器工作台，直接用 <code>openhermit web</code>。</p>
    </div>

    <h3>默认路径和端口</h3>
    <table>
      <thead>
        <tr><th>项目</th><th>默认值</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr><td>Web UI</td><td><code>http://127.0.0.1:5680/teams</code></td><td>团队工作台入口</td></tr>
        <tr><td>本地状态</td><td><code>~/.hermit/</code></td><td>团队、任务、消息、设置、审计</td></tr>
        <tr><td>Claude Code 会话</td><td><code>~/.claude/projects</code></td><td>用量和会话数据来源</td></tr>
        <tr><td>Codex 会话</td><td><code>~/.codex/sessions</code></td><td>Codex 用量数据来源</td></tr>
      </tbody>
    </table>

    <h2 id="first-use">3. 首次使用流程</h2>
    <ol>
      <li>运行 <code>openhermit</code> 或 <code>openhermit web</code></li>
      <li>浏览器打开 <code>http://127.0.0.1:5680/teams</code></li>
      <li>点击「创建数字员工」，填写团队名称和 slug</li>
      <li>选择运行时（如 <code>claudecode</code>、<code>codex</code>）</li>
      <li>绑定本地项目目录</li>
      <li>创建任务，开始使用</li>
    </ol>

    <h3>支持的 Agent 运行时</h3>
    <table>
      <thead>
        <tr><th>级别</th><th>运行时</th></tr>
      </thead>
      <tbody>
        <tr><td>一等适配</td><td>Claude Code、Codex、Gemini、OpenCode、Cursor</td></tr>
        <tr><td>兼容注册</td><td>Devin、Qoder、Kimi、iFlow、ACP、tmux</td></tr>
      </tbody>
    </table>

    <h2 id="usage-report">4. 用量上报</h2>

    <h3>快速开始</h3>
    <ol>
      <li>运行 <code>openhermit</code> 进入终端导航器</li>
      <li>选择「用量 Usage Sync」，回车展开</li>
      <li>选择要启用的运行时（Claude Code / Codex），回车开启</li>
      <li>首次启用后，系统自动扫描本地历史会话并补齐数据；后续增量扫描</li>
    </ol>

    <h3>Web 工作台查看用量</h3>
    <ol>
      <li>运行 <code>openhermit web</code> 或在终端导航器选择「工作台 Workspace」</li>
      <li>浏览器打开 <code>http://127.0.0.1:5680</code></li>
      <li>进入任意团队页面，顶部 Tab 切换到「用量」查看 token 消耗趋势、会话数、消息量</li>
      <li>支持按成员、运行时、时间段筛选</li>
    </ol>

    <div class="callout success">
      <div class="callout-title">提示</div>
      <p>Web 工作台在后台持续运行时（<code>openhermit --daemon</code>）会自动定时采集，无需手动触发。打开浏览器即可查看最新数据。</p>
    </div>

    <h3>配置上报目标（AgentBus）</h3>
    <ol>
      <li>运行 <code>openhermit</code> 进入导航器</li>
      <li>选择「账号 Account」→ 登录 AgentBus 账号</li>
      <li>登录成功后，用量数据会自动上报到 AgentBus 服务端</li>
      <li>企业管理者可在 AgentBus 看板查看全团队汇总数据</li>
    </ol>

    <h3>支持的数据源</h3>
    <table>
      <thead>
        <tr><th>运行时</th><th>数据位置</th><th>采集内容</th></tr>
      </thead>
      <tbody>
        <tr><td>Claude Code</td><td><code>~/.claude/projects/**/*.jsonl</code></td><td>token 用量、会话数、消息量；支持 IM 归因</td></tr>
        <tr><td>Codex</td><td><code>~/.codex/sessions/**/*.jsonl</code></td><td>token 用量（output_tokens 为主）</td></tr>
      </tbody>
    </table>

    <div class="callout">
      <div class="callout-title">上报机制</div>
      <ul>
        <li>统一通过 <code>POST /api/v1/report/messages</code> 上报</li>
        <li>支持断点续传，幂等去重（基于 eventId）</li>
        <li>启动后初始化扫描，后续按周期（约 5 分钟）增量扫描</li>
        <li>隐私安全：只上报 metadata（token 数、时间戳、维度），不上传消息正文、代码内容或密钥</li>
      </ul>
    </div>

    <h3>Codex 已知限制</h3>
    <p>Codex 本地 JSONL 中 <code>input_tokens</code> 和 <code>cached_input_tokens</code> 经常为 0，因此无法精确计算上下文窗口占比。<code>output_tokens</code> 上报正常，不影响整体用量统计。</p>

    <h3>启用上报</h3>
    <p>运行 <code>openhermit</code> 进入导航器，选择「用量上报」相关选项，可多选启用 Claude Code 和 Codex 的数据上报。需要配置目标服务端（AgentBus）地址。</p>

    <h2 id="faq">5. 常见问题</h2>

    <h3>Q: EACCES: permission denied 权限报错</h3>
    <div class="callout error">
      <div class="callout-title">典型报错</div>
      <pre><code>Error: EACCES: permission denied, open '~/.hermit/telemetry/worker.pid'
# 或
npm error code EACCES syscall rename</code></pre>
    </div>
    <p><strong>原因：</strong>之前以 <code>sudo</code> 运行过 hermit 或 npm，导致部分文件被 root 占有。</p>
    <p><strong>修复：</strong></p>
    <pre><code># 修复 telemetry 文件权限
sudo chown $(whoami) ~/.hermit/telemetry/worker.pid

# 如果 npm global 目录也报权限错误
sudo chown -R $(whoami) ~/.npm-global</code></pre>
    <div class="callout warn">
      <div class="callout-title">预防</div>
      <p>不要用 <code>sudo</code> 运行 <code>openhermit</code> 或 <code>npm install -g</code>。如果 npm global 目录权限正确（属于当前用户），全局安装不需要 sudo。</p>
    </div>

    <h3>Q: openhermit 命令找不到</h3>
    <p>npm 全局 bin 目录可能不在 PATH 中。检查并添加：</p>
    <pre><code># 查看 npm 全局 bin 目录
npm config get prefix

# 添加到 PATH（写入 ~/.zshrc 或 ~/.bashrc）
export PATH="$(npm config get prefix)/bin:$PATH"</code></pre>

    <h3>Q: 更新失败</h3>
    <p>如果 <code>openhermit update</code> 失败，可以直接用 npm 重新安装：</p>
    <pre><code>npm install -g @yancyyu/openhermit@latest --prefer-online</code></pre>

    <h3>Q: Web UI 打不开</h3>
    <ul>
      <li>确认 daemon 正在运行：<code>openhermit status</code></li>
      <li>检查端口是否被占用：<code>lsof -i :5680</code></li>
      <li>尝试指定其他端口：<code>openhermit --port 8080</code></li>
    </ul>

    <h3>Q: 本地用量里为什么有 IM 用量？</h3>
    <p>IM 触发的 Agent 执行最终仍落到本地 Claude Code session。AgentCli 统一读取本地 JSONL，再根据 bridge 元数据归因为 <code>source=feishu</code> 或 <code>source=wechat</code>。</p>

    <h3>Q: worktree 是安全沙箱吗？</h3>
    <p>不是。worktree 是 Git 工作区隔离，用来降低并行编辑冲突；不等于容器隔离或权限沙箱。</p>

    <h3>Q: AgentCli 会上传代码或消息内容吗？</h3>
    <p>默认 metadata-only：不上传消息正文、助手回复、工具输入输出、cron prompt 或 MCP 密钥。具体上报范围取决于管理员在 Settings 中的 Task Bus / Redis 配置。</p>

    <h3>Q: Codex 上报数据不完整？</h3>
    <p>这是已知限制。Codex 本地 JSONL 中 <code>input_tokens</code> 字段经常为 0（OpenAI 本地客户端未完整记录），但 <code>output_tokens</code> 正常。不影响总用量统计，只是无法精确展示输入 token 占比。</p>
  </div>

  <footer class="footer">
    <div class="footer-left">&copy; 2026 AgentCli. AGPL-3.0 License.</div>
    <div class="footer-links">
      <a href="./">首页</a>
      <a href="https://github.com/yancyuu/Hermit/issues">反馈</a>
    </div>
  </footer>
</body>
</html>
`;

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
writeText('index.html', html);
writeText('guide.html', guideHtml);
copyFile('scripts/install.sh', 'install.sh');
copyFile('public/icon.png', 'icon.png');

console.log(`Built GitHub Pages site at ${OUT_DIR}`);
console.log('- index.html');
console.log('- guide.html');
console.log('- install.sh');
console.log('- icon.png');
