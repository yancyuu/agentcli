import { describe, expect, it } from 'vitest';

import { buildUsageTelemetryLaunchdPlist } from '@main/telemetry/autostart';

describe('usage telemetry launchd autostart', () => {
  it('builds a foreground worker plist without daemon wrapper', () => {
    const plist = buildUsageTelemetryLaunchdPlist({
      label: 'com.openhermit.telemetry',
      nodePath: '/usr/local/bin/node',
      cliPath: '/repo/bin/hermit.mjs',
      hermitHome: '/tmp/hermit-home',
    });

    expect(plist).toContain('<key>Label</key>');
    expect(plist).toContain('<string>com.openhermit.telemetry</string>');
    expect(plist).toContain('<key>ProgramArguments</key>');
    expect(plist).toContain('<string>/usr/local/bin/node</string>');
    expect(plist).toContain('<string>/repo/bin/hermit.mjs</string>');
    expect(plist).toContain('<string>__telemetry-worker</string>');
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<key>HERMIT_HOME</key>');
    expect(plist).toContain('<string>/tmp/hermit-home</string>');
    expect(plist).not.toContain('--daemon');
    expect(plist).not.toContain('--upload');
  });

  it('escapes XML values in plist fields', () => {
    const plist = buildUsageTelemetryLaunchdPlist({
      label: 'com.openhermit.telemetry',
      nodePath: '/usr/local/bin/node',
      cliPath: '/repo & bin/<hermit>.mjs',
      hermitHome: '/tmp/hermit & home/<test>',
    });

    expect(plist).toContain('/repo &amp; bin/&lt;hermit&gt;.mjs');
    expect(plist).toContain('/tmp/hermit &amp; home/&lt;test&gt;');
  });
});
