// navigation.mjs — Pure terminal-menu UI primitives.
// No domain dependencies. Used by hermit.mjs to render any action menu.
// Replaces the inline menu functions from hermit.mjs (renderNavMenu, askMenuAction,
// parseMenuKey, visibleMenuRows, etc.).
import {
  cancelCli,
  ui,
  glyphs,
  statusBarLine,
  menuColumnsLine,
  panelWidth,
  displayWidth,
  clearTerminal,
  writeFrameSync,
} from './terminal.mjs';

// --- Key parsing -------------------------------------------------------------

export function parseMenuKey(input) {
  const key = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  if (key === '\x1b') return { type: 'escape-start' };
  if (key === '\r' || key === '\n') return { type: 'choose' };
  if (/^[1-9]$/u.test(key)) return { type: 'quick-select', index: Number.parseInt(key, 10) - 1 };
  return { type: 'unknown' };
}

export function parseMenuKeys(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  const keys = [];
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '\x1b') {
      const seq = text.slice(i, i + 3);
      if (seq === '\x1b[A') { keys.push({ type: 'move', delta: -1 }); i += 3; continue; }
      if (seq === '\x1b[B') { keys.push({ type: 'move', delta: 1 }); i += 3; continue; }
      if (seq === '\x1b[C') { keys.push({ type: 'choose' }); i += 3; continue; }
      if (seq === '\x1b[D') { keys.push({ type: 'back' }); i += 3; continue; }
      keys.push({ type: 'escape-start' }); i += 1; continue;
    }
    // Real terminals send Enter as CRLF (\r\n) or occasionally LFCR (\n\r).
    // Collapse the pair into a SINGLE choose — otherwise one Enter keystroke
    // fires two choose events, which opened-then-collapsed the submenu
    // ("二级菜单闪现消失") and caused listener-reuse races in multi-page nav.
    if (ch === '\r' || ch === '\n') {
      const next = text[i + 1];
      if ((ch === '\r' && next === '\n') || (ch === '\n' && next === '\r')) i += 2;
      else i += 1;
      keys.push({ type: 'choose' });
      continue;
    }
    keys.push(parseMenuKey(ch));
    i += 1;
  }
  return keys;
}

// --- Menu rendering ---------------------------------------------------------

export function visibleMenuRows(actions, expandedActionIds, isDeveloperModeEnabled) {
  const rows = [];
  for (const action of actions) {
    if (action.developerOnly && !isDeveloperModeEnabled) continue;
    rows.push({ action, depth: 0 });
    if (expandedActionIds.has(action.id)) {
      for (const child of action.children || []) {
        if (child.developerOnly && !isDeveloperModeEnabled) continue;
        rows.push({ action: child, parent: action, depth: 1 });
      }
    }
  }
  return rows;
}

export function renderBusyScreen(title, message) {
  clearTerminal();
  console.log(ui.bold(title));
  console.log(message);
}

export function renderNavMenu(
  title,
  subtitle,
  actions,
  selectedIndex,
  escapeAction = 'exit',
  expandedActionIds = new Set(),
  notice = '',
  isDeveloperModeEnabled = () => false,
  actionStateLabel = () => ({ text: '', state: 'info' }),
  statusItems = [],
) {
  // Redraw IN PLACE via writeFrameSync (cursor home + per-line clear-to-EOL) —
  // NOT a full-screen clear. Wiping the screen on every arrow press is what made
  // the menu flash ("一闪一闪") whenever ↑/↓ was pressed.
  const width = Math.min(panelWidth(), 60);
  const lines = [];
  lines.push(ui.dim(glyphs.h.repeat(width)));
  if (title) lines.push(ui.bold(title));
  if (subtitle) lines.push(ui.dim(subtitle));
  if (notice) lines.push(notice);

  const rows = visibleMenuRows(actions, expandedActionIds, isDeveloperModeEnabled());
  if (statusItems.length) {
    lines.push(statusBarLine(statusItems, width));
    lines.push(ui.dim(glyphs.h.repeat(width)));
  }

  const parts = rows.map((row) => {
    const { action, depth } = row;
    const focused = rows.indexOf(row) === selectedIndex;
    const expanded = expandedActionIds.has(action.id);
    const pointer = focused ? ui.accent(glyphs.pointer) : ' ';
    const hasChildren = Boolean(action.children?.length) && !action.comingSoon;
    const caret = hasChildren ? (expanded ? glyphs.caretOpen : glyphs.caretClosed) : ' ';
    const state = actionStateLabel(action);
    const selected = action.toggle && state.state === 'ok';
    const marker = selected ? ui.success(glyphs.checked) : ' ';
    const label = selected ? ui.success(action.label) : focused ? ui.accent(action.label) : action.label;
    const left = depth === 0
      ? `${pointer} ${caret} ${label}`
      : `${pointer}   ${marker} ${label}`;
    const right = state.text && !action.comingSoon && (depth === 0 || Boolean(action.toggle))
      ? `${ui.dim(glyphs.v)} ${state.text}`
      : '';
    return { left, right };
  });

  // Column-align the state chips across rows. displayWidth measures VISIBLE
  // width (strips ANSI); the old `Math.max(max, ui.dim(left))` coerced a painted
  // string to NaN, so chipCol was always NaN and chips never aligned.
  const maxLeft = parts.reduce((max, { left }) => Math.max(max, displayWidth(left)), 0);
  const maxRight = parts.reduce((max, { right }) => Math.max(max, displayWidth(right)), 0);
  const chipCol = Math.max(maxLeft + 6, width - maxRight);

  rows.forEach((row, index) => {
    const { left, right } = parts[index];
    if (row.action.id === escapeAction && index > 0) {
      lines.push(ui.dim(glyphs.h.repeat(width)));
    }
    lines.push(menuColumnsLine(left, right, chipCol));
  });

  lines.push(ui.dim(glyphs.h.repeat(width)));
  lines.push(ui.dim('  ← 返回  |  ↑↓ 选择  |  Enter 进入/确认  |  Esc/Ctrl+C 退出'));
  writeFrameSync(lines);
}

// --- Interactive menu -------------------------------------------------------

export async function askMenuAction({
  title,
  subtitle,
  actions,
  escapeAction = 'exit',
  statusItems = [],
  // Callers pass `hasDeveloperModeEnabled`; alias it to the local name the
  // render helpers expect so developerOnly rows (e.g. upload-logs) actually show.
  hasDeveloperModeEnabled: isDeveloperModeEnabled = () => false,
  actionStateLabel = () => ({ text: '', state: 'info' }),
  onAction = null,
  inlineBusyMessage = (action) => `正在处理：${action.label}，请稍候...`,
}) {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let busy = false;
    let notice = '';
    const expandedActionIds = new Set();
    const stdin = process.stdin;

    function cleanup() {
      stdin.off('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\x1b[?25h');
    }

    function choose(actionId) {
      cleanup();
      process.stdout.write('\n');
      resolve(actionId);
    }

    function repaint(nextNotice = notice) {
      notice = nextNotice;
      // statusItems may be a function so every repaint re-reads live state —
      // otherwise the top status bar stays stale after an inline login / toggle.
      const items = typeof statusItems === 'function' ? statusItems() : statusItems;
      renderNavMenu(
        title,
        subtitle,
        actions,
        selectedIndex,
        escapeAction,
        expandedActionIds,
        notice,
        isDeveloperModeEnabled,
        actionStateLabel,
        items,
      );
    }

    function visibleRows() {
      return visibleMenuRows(actions, expandedActionIds, isDeveloperModeEnabled());
    }

    async function chooseInline(row) {
      if (!onAction) return false;
      busy = true;
      stdin.off('data', onData);
      renderBusyScreen(title, inlineBusyMessage(row.action));
      try {
        const handled = await onAction(row.action, { row, repaint });
        if (!handled) return false;
        repaint('');
        return true;
      } finally {
        busy = false;
        // onAction's waitForContinue (default) tears down raw mode + pauses
        // stdin. Restore the menu's terminal state here so arrow keys keep
        // working after the first inline action — otherwise they echo as
        // ^[[A/^[[B text in cooked mode and navigation dies until restart.
        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
      }
    }

    function toggleExpand(id) {
      if (expandedActionIds.has(id)) expandedActionIds.delete(id);
      else expandedActionIds.add(id);
      repaint();
    }

    async function chooseCurrent() {
      const rows = visibleRows();
      const row = rows[selectedIndex];
      if (!row) return;
      if (row.action.comingSoon) {
        repaint(typeof row.action.comingSoon === 'string' ? row.action.comingSoon : '该功能开发中，敬请期待');
        return;
      }
      // Top-level parent (has children): toggle inline expansion (accordion).
      // Children render indented below; Enter again collapses. Does NOT resolve —
      // the menu stays open. (The old flash/disappear was the parseMenuKeys CRLF
      // double-choose + dead routing, both now fixed; expansion state lives in
      // this closure so repaints keep it.)
      if (row.depth === 0 && row.action.children?.length) {
        toggleExpand(row.action.id);
        return;
      }
      // Child row or leaf top-level: run via onAction if provided, else resolve.
      if (await chooseInline(row)) return;
      choose(row.action.id);
    }

    function move(delta) {
      const rows = visibleRows();
      selectedIndex = (selectedIndex + delta + rows.length) % rows.length;
      repaint();
    }

    async function handleKey(key) {
      if (key.type === 'exit' || key.type === 'escape-start') {
        cleanup();
        cancelCli();
        return;
      }
      if (key.type === 'back') {
        if (escapeAction === 'stay') { repaint(); return; }
        cleanup();
        resolve(escapeAction);
        return;
      }
      if (key.type === 'choose') { await chooseCurrent(); return; }
      if (key.type === 'move') { move(key.delta); return; }
      if (key.type === 'quick-select') {
        const rows = visibleRows();
        if (rows[key.index]) {
          selectedIndex = key.index;
          await chooseCurrent();
        }
      }
    }

    async function onData(chunk) {
      if (busy) { repaint('正在处理上一个操作，请稍候...'); return; }
      for (const key of parseMenuKeys(chunk)) {
        if (busy) break;
        await handleKey(key);
      }
    }

    process.stdout.write('\x1b[?25l');
    repaint();
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

// --- Continue prompt --------------------------------------------------------

export async function waitForContinue(message = '按 Enter 返回 | ← 返回上一级 | Esc/Ctrl+C 退出', options = {}) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const keepMenuInput = Boolean(options.keepMenuInput);

    function cleanup() {
      stdin.off('data', onData);
      if (!keepMenuInput) {
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.pause();
      }
    }

    function finish(result) {
      cleanup();
      resolve(result);
    }

    function onData(chunk) {
      for (const key of parseMenuKeys(chunk)) {
        if (key.type === 'choose') {
          finish('continue');
          return;
        }
        if (key.type === 'back') {
          finish('back');
          return;
        }
        if (key.type === 'escape-start') {
          finish('back');
          return;
        }
        if (key.type === 'exit') {
          cleanup();
          cancelCli();
          return;
        }
      }
    }

    console.log('');
    console.log(ui.dim(message));
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}
