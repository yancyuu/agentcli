import type { CcAgentType } from '@shared/types/ccConnect';
import { ProviderBrandLogo } from '@renderer/components/common/ProviderBrandLogo';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { ALL_AGENT_TYPES, AGENT_TYPE_LABELS } from './HarnessCards';

interface HarnessSelectProps {
  value: CcAgentType;
  onChange: (value: CcAgentType) => void;
  className?: string;
  id?: string;
}

const HARNESS_PROVIDER_MAP: Partial<
  Record<CcAgentType, 'anthropic' | 'codex' | 'gemini' | 'opencode'>
> = {
  claudecode: 'anthropic',
  codex: 'codex',
  gemini: 'gemini',
  opencode: 'opencode',
};

function HarnessIcon({ type, className }: { type: CcAgentType; className?: string }) {
  const providerId = HARNESS_PROVIDER_MAP[type];
  if (providerId) {
    return <ProviderBrandLogo providerId={providerId} className={className} />;
  }
  return <span className={className}>{EMOJI_FALLBACK[type]}</span>;
}

const EMOJI_FALLBACK: Record<CcAgentType, string> = {
  claudecode: '🤖',
  codex: '🔬',
  cursor: '💻',
  gemini: '💎',
  iflow: '🌊',
  kimi: '🌙',
  devin: '🧑‍💻',
  opencode: '🔓',
  qoder: '⚡',
  pi: '🥧',
  acp: '🔗',
  tmux: '🖥️',
};

export function HarnessSelect({ value, onChange, className, id }: HarnessSelectProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as CcAgentType)}>
      <SelectTrigger id={id} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ALL_AGENT_TYPES.map((type) => (
          <SelectItem key={type} value={type}>
            <div className="flex items-center gap-2">
              <HarnessIcon type={type} className="size-4 shrink-0" />
              <span>{AGENT_TYPE_LABELS[type]}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export { HarnessIcon, HARNESS_PROVIDER_MAP, EMOJI_FALLBACK };
