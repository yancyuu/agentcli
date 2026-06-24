// terminal.mjs — ANSI/display primitives, status pills, box drawing, prompts,
// generic JSON output, and the cancel-on-SIGINT handler bound to the readline
// prompt interface. Pure leaf module (only branding deps).

import { createInterface } from 'node:readline/promises';

import { BRAND } from '../branding.mjs';

let cancelHandled = false;

function cancelCli() {
  if (cancelHandled) return;
  cancelHandled = true;
  const message = process.stdout.isTTY && process.env.NO_COLOR !== '1' ? `\x1b[2m已退出 ${BRAND.stylizedName} 终端\x1b[0m` : `已退出 ${BRAND.stylizedName} 终端`;
  console.log(`\n${message}`);
  process.exit(130);
}
function printJson(value, exitCode = 0) {
  console.log(JSON.stringify(value, null, 2));
  process.exit(exitCode);
}
const CLI_MENU_WIDTH = 72;
const useAnsi = process.stdout.isTTY && process.env.NO_COLOR !== '1';
const useUnicodeUi = process.platform !== 'win32';
const glyphs = useUnicodeUi
  ? { h: '─', v: '│', tl: '╭', tr: '╮', ml: '├', mr: '┤', bl: '╰', br: '╯', dot: '●', pointer: '❯', checked: '✓', unchecked: ' ', caretOpen: '▾', caretClosed: '▸' }
  : { h: '-', v: '|', tl: '+', tr: '+', ml: '+', mr: '+', bl: '+', br: '+', dot: '*', pointer: '>', checked: 'x', unchecked: ' ', caretOpen: 'v', caretClosed: '>' };

function ansi(value, code) {
  return useAnsi ? `\x1b[${code}m${value}\x1b[0m` : value;
}

const ui = {
  bold: (value) => ansi(value, '1'),
  dim: (value) => ansi(value, '2'),
  accent: (value) => ansi(value, '36'),
  success: (value) => ansi(value, '32'),
  warn: (value) => ansi(value, '33'),
  danger: (value) => ansi(value, '31'),
};
function isInteractiveCli() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function createPromptInterface() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', cancelCli);
  return rl;
}

async function askText(rl, label, defaultValue = '') {
  const suffix = defaultValue ? `  默认：${defaultValue}` : '';
  const answer = (await rl.question(`\n${label}${suffix}\n› `)).trim();
  return answer || defaultValue;
}

async function askRequired(rl, label, defaultValue = '') {
  while (true) {
    const answer = await askText(rl, label, defaultValue);
    if (answer.trim()) return answer.trim();
    console.log('  这个值不能为空。');
  }
}

async function askChoice(rl, label, choices, defaultValue) {
  console.log(`\n${label}`);
  choices.forEach((choice, index) => {
    const marker = choice === defaultValue ? '  推荐' : '';
    console.log(`  ${index + 1}. ${choice}${marker}`);
  });
  while (true) {
    const answer = (await rl.question(`› 请选择 1-${choices.length}，直接回车使用 ${defaultValue}: `)).trim();
    if (!answer) return defaultValue;
    const index = Number.parseInt(answer, 10) - 1;
    if (Number.isInteger(index) && choices[index]) return choices[index];
    if (choices.includes(answer)) return answer;
    console.log('  无效选择，请重新输入。');
  }
}

function charDisplayWidth(char) {
  return /[ᄀ-ᅟ〈〉⺀-꓏가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/u.test(char) ? 2 : 1;
}

function stripAnsi(value) {
  return String(value).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function displayWidth(value) {
  return Array.from(stripAnsi(value)).reduce((sum, char) => sum + charDisplayWidth(char), 0);
}

function fitDisplay(value, width) {
  let result = '';
  let used = 0;
  for (const char of Array.from(String(value))) {
    const charWidth = charDisplayWidth(char);
    if (used + charWidth > width) break;
    result += char;
    used += charWidth;
  }
  return result + ' '.repeat(Math.max(0, width - used));
}

function truncateDisplay(value, width) {
  const raw = String(value);
  if (displayWidth(raw) <= width) return raw;

  let result = '';
  let used = 0;
  for (let i = 0; i < raw.length;) {
    if (raw[i] === '\x1b' && raw[i + 1] === '[') {
      const match = raw.slice(i).match(/^\x1B\[[0-?]*[ -/]*[@-~]/);
      if (match) {
        result += match[0];
        i += match[0].length;
        continue;
      }
    }
    const char = Array.from(raw.slice(i))[0];
    const charWidth = charDisplayWidth(char);
    if (used + charWidth > Math.max(0, width - 1)) break;
    result += char;
    used += charWidth;
    i += char.length;
  }
  return `${result}…`;
}

function statusDot(state) {
  const dot = glyphs.dot;
  if (state === 'ok') return ui.success(dot);
  if (state === 'warn') return ui.warn(dot);
  if (state === 'error') return ui.danger(dot);
  if (state === 'off') return ui.dim(dot);
  return ui.accent(dot);
}

function formatStatusPill(label, state = 'info') {
  return `${statusDot(state)} ${label}`;
}

function colorByState(value, state) {
  if (state === 'ok') return ui.success(value);
  if (state === 'warn') return ui.warn(value);
  if (state === 'error') return ui.danger(value);
  if (state === 'off') return ui.dim(value);
  return value;
}

function rowStateFromValue(value, fallback = 'info') {
  const text = stripAnsi(value);
  if (/失败|错误|异常|未运行|无效|不可用/u.test(text)) return 'error';
  if (/等待|未知|未连接|正在|请先/u.test(text)) return 'warn';
  if (/关闭|未登录|未启用|不支持/u.test(text)) return 'off';
  if (/开启|已启动|已运行|运行中|正常|已登录|成功/u.test(text)) return 'ok';
  return fallback;
}

function printStatusBar(items = []) {
  const visible = items.filter(Boolean);
  if (visible.length === 0) return;
  console.log(visible.map((item) => `${statusDot(item.state)} ${colorByState(item.label, item.state)}`).join(ui.dim('  ·  ')));
}

function boxLine(left, fill = glyphs.h, right = left) {
  return ui.dim(`${left}${fill.repeat(CLI_MENU_WIDTH)}${right}`);
}

function boxContentLine(content = '') {
  const maxContentWidth = CLI_MENU_WIDTH - 1;
  const visible = truncateDisplay(content, maxContentWidth);
  const padding = ' '.repeat(Math.max(0, maxContentWidth - displayWidth(visible)));
  return `${ui.dim(glyphs.v)} ${visible}${padding}${ui.dim(glyphs.v)}`;
}

function boxColumnsLine(left = '', right = '') {
  const maxContentWidth = CLI_MENU_WIDTH - 1;
  const rightVisible = truncateDisplay(right, 18);
  const leftWidth = Math.max(1, maxContentWidth - displayWidth(rightVisible) - 2);
  const leftVisible = truncateDisplay(left, leftWidth);
  const gap = ' '.repeat(Math.max(2, maxContentWidth - displayWidth(leftVisible) - displayWidth(rightVisible)));
  return `${ui.dim(glyphs.v)} ${leftVisible}${gap}${rightVisible}${ui.dim(glyphs.v)}`;
}

function menuColumnsLine(left = '', right = '') {
  const rightVisible = truncateDisplay(right, 18);
  const leftWidth = Math.max(1, CLI_MENU_WIDTH - displayWidth(rightVisible) - 2);
  const leftVisible = truncateDisplay(left, leftWidth);
  const gap = ' '.repeat(Math.max(2, CLI_MENU_WIDTH - displayWidth(leftVisible) - displayWidth(rightVisible)));
  return `${leftVisible}${gap}${rightVisible}`;
}

export {
  cancelCli,
  printJson,
  ansi,
  ui,
  glyphs,
  CLI_MENU_WIDTH,
  useAnsi,
  useUnicodeUi,
  isInteractiveCli,
  createPromptInterface,
  askText,
  askRequired,
  askChoice,
  charDisplayWidth,
  stripAnsi,
  displayWidth,
  fitDisplay,
  truncateDisplay,
  statusDot,
  formatStatusPill,
  colorByState,
  rowStateFromValue,
  printStatusBar,
  boxLine,
  boxContentLine,
  boxColumnsLine,
  menuColumnsLine,
};
