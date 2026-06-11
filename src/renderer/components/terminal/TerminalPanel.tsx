/**
 * TerminalPanel — a good-looking, read-only terminal-style panel for rendering
 * command / CLI output faithfully.
 *
 * Unlike the structured markdown renderers, this preserves the raw terminal feel:
 *   - full ANSI color / decoration fidelity (via `anser`)
 *   - monospace, whitespace-exact output
 *   - carriage-return (\r) overwrite handling so progress bars settle to their
 *     final frame instead of dumping every intermediate line
 *   - optional `$ command` prompt line so a Bash call reads like a real terminal
 *
 * It is intentionally lightweight: the session view is a read-only viewer of
 * recorded output, so we only need faithful rendering, not a live PTY.
 */

import { useMemo, useState } from 'react';

import Anser, { type AnserJsonEntry } from 'anser';
import { Check, Copy } from 'lucide-react';

interface TerminalPanelProps {
  /** Raw output text, may contain ANSI escape sequences. */
  text: string;
  /** Optional command to render as a `$ command` prompt line above the output. */
  command?: string;
  /** Optional label shown in the header bar (e.g. a short description). */
  title?: string;
  /** Max body height in px before scrolling. Defaults to 384. */
  maxHeight?: number;
  className?: string;
}

/**
 * Collapse carriage-return overwrites within each line and strip non-color
 * escape sequences (cursor moves, screen clears, OSC) that would otherwise
 * render as garbage. SGR color codes are left intact for `anser`.
 */
function normalizeTerminalText(raw: string): string {
  // Strip OSC sequences: ESC ] ... BEL  or  ESC ] ... ESC \
  let out = raw.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
  // Strip CSI sequences that are NOT SGR ("m"): cursor movement, erase, etc.
  out = out.replace(/\x1b\[[0-9;?]*[A-Za-ln-z]/g, '');
  // Collapse \r overwrites per line: later segments overwrite earlier from col 0.
  out = out
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line;
      let acc = '';
      for (const seg of line.split('\r')) {
        acc = seg.length >= acc.length ? seg : seg + acc.slice(seg.length);
      }
      return acc;
    })
    .join('\n');
  return out;
}

function styleForSegment(seg: AnserJsonEntry): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (seg.fg) style.color = `rgb(${seg.fg})`;
  if (seg.bg) style.backgroundColor = `rgb(${seg.bg})`;
  const decorations = seg.decorations ?? [];
  if (decorations.includes('bold')) style.fontWeight = 600;
  if (decorations.includes('italic')) style.fontStyle = 'italic';
  if (decorations.includes('underline')) style.textDecoration = 'underline';
  if (decorations.includes('dim')) style.opacity = 0.6;
  return style;
}

const MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export const TerminalPanel = ({
  text,
  command,
  title,
  maxHeight = 384,
  className,
}: TerminalPanelProps): React.JSX.Element => {
  const [copied, setCopied] = useState(false);

  const segments = useMemo<AnserJsonEntry[]>(
    () =>
      Anser.ansiToJson(normalizeTerminalText(text ?? ''), {
        json: true,
        use_classes: false,
        remove_empty: false,
      }),
    [text]
  );

  const handleCopy = (): void => {
    const payload = command ? `$ ${command}\n${text ?? ''}` : (text ?? '');
    void navigator.clipboard?.writeText(payload).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className={`overflow-hidden rounded-lg border ${className ?? ''}`}
      style={{ borderColor: 'rgba(255,255,255,0.08)', backgroundColor: '#0c0c0f' }}
    >
      {/* Header / window chrome */}
      <div
        className="flex items-center gap-2 px-3 py-1.5"
        style={{
          backgroundColor: '#16161b',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: '#ff5f57' }} />
          <span className="size-2.5 rounded-full" style={{ backgroundColor: '#febc2e' }} />
          <span className="size-2.5 rounded-full" style={{ backgroundColor: '#28c840' }} />
        </span>
        <span
          className="ml-1 flex-1 truncate text-[11px]"
          style={{ color: 'rgba(255,255,255,0.45)', fontFamily: MONO_FONT }}
        >
          {title ?? (command ? command : 'terminal')}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors"
          style={{ color: 'rgba(255,255,255,0.45)' }}
          title="复制"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>

      {/* Body */}
      <pre
        className="overflow-auto whitespace-pre-wrap break-all px-3 py-2.5 text-xs leading-relaxed"
        style={{ maxHeight, fontFamily: MONO_FONT, color: '#d4d4d4', margin: 0 }}
      >
        {command && (
          <div className="mb-1">
            <span style={{ color: '#28c840' }}>$ </span>
            <span style={{ color: '#e8e8e8' }}>{command}</span>
          </div>
        )}
        {segments.map((seg, i) => (
          <span key={i} style={styleForSegment(seg)}>
            {seg.content}
          </span>
        ))}
      </pre>
    </div>
  );
};
