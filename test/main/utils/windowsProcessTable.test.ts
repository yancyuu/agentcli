import { describe, expect, it } from 'vitest';

import { parseTasklistVerboseCsv } from '../../../src/main/utils/windowsProcessTable';

describe('windowsProcessTable', () => {
  it('parses tasklist /v CSV output', () => {
    const stdout = [
      '"node.exe","12345","Console","1","250,000 K","Running","WIN-HOST\\user","0:00:01","N/A"',
      '"chrome.exe","6789","Console","1","100,000 K","Running","WIN-HOST\\user","0:00:02","Chrome"',
    ].join('\r\n');
    expect(parseTasklistVerboseCsv(stdout)).toEqual([
      { pid: 12345, command: 'node.exe' },
      { pid: 6789, command: 'chrome.exe' },
    ]);
  });

  it('parseTasklistVerboseCsv returns empty for empty / malformed input', () => {
    expect(parseTasklistVerboseCsv('')).toEqual([]);
    expect(parseTasklistVerboseCsv('not a csv line')).toEqual([]);
  });

  it('parseTasklistVerboseCsv ignores rows whose PID column is not a positive integer', () => {
    const stdout =
      '"System Idle Process","0","Services","0","8 K"\r\n"node.exe","42","Console","1","100 K"';
    expect(parseTasklistVerboseCsv(stdout)).toEqual([{ pid: 42, command: 'node.exe' }]);
  });
});
