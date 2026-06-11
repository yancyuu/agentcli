const FEISHU_LARK_KEYS = new Set(['feishu', 'lark']);

export function readStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key.trim(), typeof entry === 'string' ? entry.trim() : ''] as const)
      .filter(([key, entry]) => key.length > 0 && entry.length > 0)
  );
}

export function getFeishuLarkAllowValue(record: Record<string, string>): string {
  return record.lark ?? record.feishu ?? '';
}

function getFeishuLarkWriteKey(record: Record<string, string>): 'feishu' | 'lark' {
  if (record.lark !== undefined) return 'lark';
  if (record.feishu !== undefined) return 'feishu';
  return 'feishu';
}

function hasFeishuLarkKey(record: Record<string, string>): boolean {
  return record.feishu !== undefined || record.lark !== undefined;
}

export function withFeishuLarkAllowValue(
  base: Record<string, string>,
  value: string
): Record<string, string> {
  const source = readStringRecord(base);
  const next = { ...source };
  const trimmed = value.trim();
  const aliasKey = getFeishuLarkWriteKey(source);

  delete next.feishu;
  delete next.lark;

  if (trimmed) {
    next[aliasKey] = trimmed;
  }

  return next;
}

export function buildFeishuLarkAllowUpdatePayload(
  base: Record<string, string>,
  value: string
): Record<string, string> | undefined {
  const source = readStringRecord(base);
  const next = withFeishuLarkAllowValue(source, value);
  const trimmed = value.trim();

  if (trimmed) return next;

  if (hasFeishuLarkKey(source)) {
    return {
      ...next,
      feishu: '',
      lark: '',
    };
  }

  return undefined;
}

export function buildPlatformAllowUpdatePayload(
  base: Record<string, string>,
  values: Record<string, string>
): Record<string, string> | undefined {
  const source = readStringRecord(base);
  const next = readStringRecord(values);

  const keys = new Set([...Object.keys(source), ...Object.keys(values)]);
  const changed = [...keys].some((key) => (source[key] ?? '') !== (next[key] ?? ''));

  return changed ? next : undefined;
}

export function omitEmptyAllowMap(
  record: Record<string, string>
): Record<string, string> | undefined {
  return Object.keys(record).length > 0 ? record : undefined;
}

export function hasFeishuLarkDeleteMarker(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, entry]) =>
      FEISHU_LARK_KEYS.has(key.trim()) && (typeof entry !== 'string' || entry.trim().length === 0)
  );
}
