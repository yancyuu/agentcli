import { describe, expect, it } from 'vitest';

import { parsePosixPsOutput } from '../../../src/main/utils/posixProcessTable';

describe('posixProcessTable', () => {
  it('parses `ps -ax -o pid=,command=` output', () => {
    const stdout = [
      '  101 /usr/bin/node runtime --team-name demo --agent-id agent-a',
      '  202 /Applications/Foo.app/Contents/MacOS/Foo --flag',
      '12345 zsh',
    ].join('\n');
    expect(parsePosixPsOutput(stdout)).toEqual([
      { pid: 101, command: '/usr/bin/node runtime --team-name demo --agent-id agent-a' },
      { pid: 202, command: '/Applications/Foo.app/Contents/MacOS/Foo --flag' },
      { pid: 12345, command: 'zsh' },
    ]);
  });

  it('parsePosixPsOutput returns empty for blank / malformed input', () => {
    expect(parsePosixPsOutput('')).toEqual([]);
    expect(parsePosixPsOutput('not a ps row')).toEqual([]);
  });

  it('parsePosixPsOutput skips rows missing pid or command', () => {
    const stdout = ['  not-a-pid foo', '  0  init', '  99 ', '  17 node helper.js'].join('\n');
    expect(parsePosixPsOutput(stdout)).toEqual([{ pid: 17, command: 'node helper.js' }]);
  });
});
