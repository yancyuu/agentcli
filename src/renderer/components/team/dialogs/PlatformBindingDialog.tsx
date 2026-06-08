import { useEffect, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Settings2, Smartphone } from 'lucide-react';

import { isQRPlatform, platformMeta } from './platformMeta';
import PlatformManualForm from './PlatformManualForm';
import PlatformSetupQR from './PlatformSetupQR';

interface PlatformOption {
  key: string;
  label: string;
  color: string;
  icon: 'qr' | 'settings';
}

const PLATFORM_OPTIONS: PlatformOption[] = [
  {
    key: 'feishu',
    label: '飞书 / Lark',
    color: 'bg-blue-50 dark:bg-blue-900/30 text-indigo-600 dark:text-indigo-400',
    icon: 'qr',
  },
  {
    key: 'weixin',
    label: '微信',
    color: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400',
    icon: 'qr',
  },
  {
    key: 'telegram',
    label: 'Telegram',
    color: 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400',
    icon: 'settings',
  },
  {
    key: 'discord',
    label: 'Discord',
    color: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
    icon: 'settings',
  },
  {
    key: 'slack',
    label: 'Slack',
    color: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
    icon: 'settings',
  },
  {
    key: 'dingtalk',
    label: '钉钉',
    color: 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400',
    icon: 'settings',
  },
  {
    key: 'wecom',
    label: '企业微信',
    color: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    icon: 'settings',
  },
  {
    key: 'qq',
    label: 'QQ (OneBot)',
    color: 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400',
    icon: 'settings',
  },
  {
    key: 'qqbot',
    label: 'QQ Bot (官方)',
    color: 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400',
    icon: 'settings',
  },
  {
    key: 'line',
    label: 'LINE',
    color: 'bg-lime-50 dark:bg-lime-900/30 text-lime-600 dark:text-lime-400',
    icon: 'settings',
  },
  {
    key: 'weibo',
    label: '微博',
    color: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    icon: 'settings',
  },
];

type BindingStep = 'platform' | 'qr' | 'form';

interface PlatformBindingContentProps {
  projectName: string;
  workDir: string;
  agentType: string;
  onComplete: () => void;
  onCancel: () => void;
}

export function PlatformBindingContent({
  projectName,
  workDir,
  agentType,
  onComplete,
  onCancel,
}: PlatformBindingContentProps): React.JSX.Element {
  const [step, setStep] = useState<BindingStep>('platform');
  const [selectedPlatform, setSelectedPlatform] = useState('');

  useEffect(() => {
    setStep('platform');
    setSelectedPlatform('');
  }, [projectName, workDir, agentType]);

  const handlePlatformSelect = (key: string): void => {
    setSelectedPlatform(key);
    setStep(isQRPlatform(key) ? 'qr' : 'form');
  };

  if (
    step === 'qr' &&
    (selectedPlatform === 'feishu' || selectedPlatform === 'lark' || selectedPlatform === 'weixin')
  ) {
    return (
      <PlatformSetupQR
        platformType={selectedPlatform as 'feishu' | 'lark' | 'weixin'}
        projectName={projectName}
        workDir={workDir}
        agentType={agentType}
        onComplete={onComplete}
        onCancel={() => setStep('platform')}
      />
    );
  }

  if (step === 'form' && platformMeta[selectedPlatform]) {
    return (
      <PlatformManualForm
        platformType={selectedPlatform}
        platformMeta={platformMeta[selectedPlatform]}
        projectName={projectName}
        workDir={workDir}
        agentType={agentType}
        onComplete={onComplete}
        onCancel={() => setStep('platform')}
      />
    );
  }

  return (
    <div className="space-y-3 py-2">
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
        绑定渠道是可选项，用于将数字员工暴露到飞书、微信等外部平台；不绑定也可以在本机直接运行。
        <br />
        <span className="text-amber-500">⚠️ 绑定新渠道后需要重启服务，将短暂中断所有正在运行的会话。</span>
      </div>
      <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto">
        {PLATFORM_OPTIONS.map(({ key, label, color, icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => handlePlatformSelect(key)}
            className="flex items-center gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3 text-left transition-all hover:border-[var(--color-border-emphasis)] hover:bg-[var(--color-accent)]/5"
          >
            <div className={`h-9 w-9 rounded-lg ${color} flex shrink-0 items-center justify-center`}>
              {icon === 'qr' ? <Smartphone size={16} /> : <Settings2 size={16} />}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[var(--color-text)]">{label}</div>
              <div className="text-[11px] text-[var(--color-text-muted)]">{icon === 'qr' ? '扫码绑定' : '手动配置'}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="flex justify-start pt-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

interface PlatformBindingDialogProps extends PlatformBindingContentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlatformBindingDialog({
  open,
  onOpenChange,
  projectName,
  workDir,
  agentType,
  onComplete,
  onCancel,
}: PlatformBindingDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl sm:w-[40rem]">
        <DialogHeader>
          <DialogTitle className="text-sm">绑定渠道</DialogTitle>
          <DialogDescription className="text-xs">
            可选：为当前数字员工选择外部平台渠道，绑定后通过 Hermit 对外接收消息。
          </DialogDescription>
        </DialogHeader>
        <PlatformBindingContent
          key={`${projectName}:${workDir}:${agentType}:${open ? 'open' : 'closed'}`}
          projectName={projectName}
          workDir={workDir}
          agentType={agentType}
          onComplete={onComplete}
          onCancel={onCancel}
        />
      </DialogContent>
    </Dialog>
  );
}
