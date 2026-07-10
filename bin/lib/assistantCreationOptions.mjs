import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const optionsPath = path.join(repoRoot, 'src/shared/assistantCreationOptions.json');

let cachedOptions = null;

export function normalizeAssistantBindProject(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return /^[a-z0-9][a-z0-9_-]*$/.test(normalized) ? normalized : `assistant-${Date.now()}`;
}

export function assistantCreationOptions() {
  if (!cachedOptions) {
    cachedOptions = JSON.parse(readFileSync(optionsPath, 'utf-8'));
  }
  return cachedOptions;
}

export function assistantAgentTypeActions() {
  return assistantCreationOptions().agentTypes.map((option) => ({
    id: option.key,
    label: option.label,
    description: option.key,
  }));
}

export function assistantPlatformActions() {
  return assistantCreationOptions().platformOptions.map((option) => ({
    id: option.key,
    label: option.label,
    description: option.icon === 'qr' ? '扫码绑定' : '手动配置绑定',
  }));
}

export function assistantWecomModeActions() {
  return assistantCreationOptions().wecomModeOptions.map((option) => ({
    id: option.key,
    label: option.label,
    description: option.description,
  }));
}

export function isAssistantQrPlatform(platform) {
  return assistantCreationOptions().qrPlatforms.includes(platform);
}

export function assistantPlatformMeta(platform) {
  return assistantCreationOptions().platformMeta?.[platform] || null;
}

export function mergeAssistantPlatformOptions(meta, providedOptions = {}) {
  const options = { ...(meta?.defaultOptions || {}) };
  for (const [key, value] of Object.entries(providedOptions || {})) {
    if (value !== undefined && value !== '') options[key] = value;
  }
  return options;
}

export function missingRequiredAssistantFields(meta, options) {
  return (meta?.fields || [])
    .filter((field) => field.required && (options[field.key] === undefined || options[field.key] === ''))
    .map((field) => field.key);
}

export function labelForAssistantAgentType(agentType) {
  return assistantCreationOptions().agentTypes.find((option) => option.key === agentType)?.label || agentType;
}

export function labelForAssistantPlatform(platform) {
  const options = assistantCreationOptions();
  return (
    options.platformOptions.find((option) => option.key === platform)?.label ||
    options.wecomModeOptions.find((option) => option.key === platform)?.label ||
    platform
  );
}
