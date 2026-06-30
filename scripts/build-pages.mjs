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
  <title>openHermit CLI - 终端原生智能工作台</title>
  <meta name="description" content="在终端中与 AI 协作，将想法直接变为可交付软件。" />
  <meta property="og:title" content="openHermit CLI" />
  <meta property="og:description" content="终端原生智能工作台，驱动数字员工高效协作。" />
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

    /* Header */
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

    /* Hero */
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
      max-width: 600px;
      margin: 0 auto 32px;
    }

    /* Install tabs */
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

    /* Stats */
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 24px;
      max-width: 1000px;
      margin: 0 auto;
      padding: 60px 24px;
    }
    .stat-card {
      text-align: center;
      padding: 32px 16px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
    }
    .stat-number {
      font-size: 48px;
      font-weight: 800;
      color: var(--accent-light);
      line-height: 1;
      margin-bottom: 8px;
    }
    .stat-label {
      font-size: 14px;
      color: var(--text-muted);
    }

    /* Features */
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

    /* SDK section */
    .sdk-section {
      max-width: 800px;
      margin: 0 auto;
      padding: 60px 24px;
      text-align: center;
    }
    .sdk-section h2 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .sdk-section > p {
      color: var(--text-muted);
      font-size: 16px;
      margin-bottom: 28px;
    }
    .sdk-install {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px 24px;
      text-align: left;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 14px;
      color: var(--green);
    }

    /* Footer */
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
      .stats { grid-template-columns: 1fr; }
      .features-grid { grid-template-columns: 1fr; }
      .footer { flex-direction: column; text-align: center; }
    }
  </style>
</head>
<body>
  <!-- Header -->
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

  <!-- Hero -->
  <section class="hero">
    <span class="hero-badge">Terminal Native, AI Powered</span>
    <h1>openHermit CLI</h1>
    <p>在终端中与 AI 协作，围绕真实代码工作。将想法直接变为可交付软件——从开发调试到部署运维。</p>

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

  <!-- Stats -->
  <section class="stats">
    <div class="stat-card">
      <div class="stat-number">60%</div>
      <div class="stat-label">日常工作流手动步骤减少</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">2x</div>
      <div class="stat-label">修复与重构交付速度提升</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">70%</div>
      <div class="stat-label">重复性修复自动化处理</div>
    </div>
  </section>

  <!-- Features -->
  <section class="features-section">
    <div class="features-header">
      <h2>终端里的工程智能</h2>
      <p>轻量、快速、无处不在</p>
    </div>
    <div class="features-grid">
      <div class="feature-card">
        <div class="feature-icon">&gt;_</div>
        <h3>轻量即用，随时介入</h3>
        <p>启动 &lt;70ms，无需 IDE。在任何终端中执行即时修复、快速代码审查和自动化任务。</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#9881;</div>
        <h3>自动化研发流程编排</h3>
        <p>深度集成 CI/CD 管线，自动 Code Review、测试生成和问题修复。支持 Agent 调度和编排。</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#128279;</div>
        <h3>深度融入工具链</h3>
        <p>在脚本中调用 Agent，通过 ACP 协议管道化，扩展到 Neovim、Emacs 等编辑器和任意自动化场景。</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#128269;</div>
        <h3>上下文感知 Code Review</h3>
        <p>理解仓库上下文，通过评论触发审查与修复，支持多轮 Q&amp;A 和自动修改建议。</p>
      </div>
    </div>
  </section>

  <!-- SDK -->
  <section class="sdk-section">
    <h2>被集成能力</h2>
    <p>使用 openHermit 构建自定义 AI 编码工作流——流式响应、工具权限控制、MCP 连接，将代码理解和编辑能力嵌入你自己的应用。</p>
    <div class="sdk-install">
      npm install -g @yancyyu/openhermit
    </div>
  </section>

  <!-- Footer -->
  <footer class="footer">
    <div class="footer-left">&copy; 2026 openHermit. All rights reserved.</div>
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
