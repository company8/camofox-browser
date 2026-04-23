import { describe, test, expect, afterEach } from '@jest/globals';
import { resolveVncConfig } from './vnc-launcher.js';

describe('resolveVncConfig', () => {
  const originalEnableVnc = process.env.ENABLE_VNC;

  afterEach(() => {
    if (originalEnableVnc === undefined) delete process.env.ENABLE_VNC;
    else process.env.ENABLE_VNC = originalEnableVnc;
  });

  test('ENABLE_VNC=0 disables VNC even when plugin config enables it', () => {
    process.env.ENABLE_VNC = '0';

    const config = resolveVncConfig({ enabled: true, resolution: '1280x720' });

    expect(config.enabled).toBe(false);
  });

  test('ENABLE_VNC=1 enables VNC when plugin config leaves it disabled', () => {
    process.env.ENABLE_VNC = '1';

    const config = resolveVncConfig({ enabled: false, resolution: '1280x720' });

    expect(config.enabled).toBe(true);
  });
});
