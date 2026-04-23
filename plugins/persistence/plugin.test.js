import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import { createPluginEvents } from '../../lib/plugins.js';
import { register } from './index.js';

describe('persistence plugin', () => {
  let tmpDir, events, ctx, mockApp, originalProfileDir;

  beforeEach(async () => {
    originalProfileDir = process.env.CAMOFOX_PROFILE_DIR;
    delete process.env.CAMOFOX_PROFILE_DIR;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'camofox-persist-plugin-'));
    events = createPluginEvents();
    mockApp = {};
    ctx = {
      events,
      config: { cookiesDir: path.join(tmpDir, 'cookies') },
      log: jest.fn(),
    };
  });

  afterEach(async () => {
    if (originalProfileDir === undefined) delete process.env.CAMOFOX_PROFILE_DIR;
    else process.env.CAMOFOX_PROFILE_DIR = originalProfileDir;
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('skips registration when no profileDir configured', async () => {
    await register(mockApp, ctx, {});
    expect(ctx.log).toHaveBeenCalledWith('warn', expect.stringContaining('no profileDir'));
  });

  test('restores persisted state on session:creating', async () => {
    await register(mockApp, ctx, { profileDir: tmpDir });

    // Simulate a prior persisted state
    const { getUserPersistencePaths } = await import('../../lib/persistence.js');
    const { userDir, storageStatePath } = getUserPersistencePaths(tmpDir, 'user-1');
    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(storageStatePath, JSON.stringify({
      cookies: [{ name: 'sid', value: 'abc', domain: '.example.com', path: '/' }],
      origins: [],
    }));

    const contextOptions = { viewport: { width: 1280, height: 720 } };
    await events.emitAsync('session:creating', { userId: 'user-1', contextOptions });

    expect(contextOptions.storageState).toBe(storageStatePath);
  });

  test('imports bootstrap cookies even when persisted state already exists', async () => {
    await register(mockApp, ctx, { profileDir: tmpDir });

    const { getUserPersistencePaths } = await import('../../lib/persistence.js');
    const { userDir, storageStatePath } = getUserPersistencePaths(tmpDir, 'user-bootstrap');
    await fs.mkdir(userDir, { recursive: true });
    await fs.mkdir(ctx.config.cookiesDir, { recursive: true });
    await fs.writeFile(storageStatePath, JSON.stringify({ cookies: [], origins: [] }));
    await fs.writeFile(
      path.join(ctx.config.cookiesDir, 'cookies.txt'),
      '.example.com\tTRUE\t/\tTRUE\t1893456000\tsession_id\tbootstrap-token\n'
    );

    const mockContext = {
      addCookies: jest.fn(async () => {}),
      storageState: jest.fn(async ({ path: p }) => {
        await fs.writeFile(p, JSON.stringify({
          cookies: [{ name: 'session_id', value: 'bootstrap-token', domain: '.example.com', path: '/' }],
          origins: [],
        }));
      }),
    };

    await events.emitAsync('session:created', { userId: 'user-bootstrap', context: mockContext });

    expect(mockContext.addCookies).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'session_id',
        value: 'bootstrap-token',
        domain: '.example.com',
        path: '/',
        secure: true,
      }),
    ]);
    expect(mockContext.storageState).toHaveBeenCalled();
  });

  test('checkpoints on session:cookies:import', async () => {
    await register(mockApp, ctx, { profileDir: tmpDir });

    const mockContext = {
      storageState: jest.fn(async ({ path: p }) => {
        await fs.writeFile(p, JSON.stringify({ cookies: [{ name: 'x', value: 'y', domain: '.test.com', path: '/' }] }));
      }),
    };

    // Simulate session created then cookie import
    await events.emitAsync('session:created', { userId: 'user-2', context: mockContext });
    await events.emitAsync('session:cookies:import', { userId: 'user-2' });

    expect(mockContext.storageState).toHaveBeenCalled();

    // Verify file was written
    const { getUserPersistencePaths } = await import('../../lib/persistence.js');
    const { storageStatePath } = getUserPersistencePaths(tmpDir, 'user-2');
    const saved = JSON.parse(await fs.readFile(storageStatePath, 'utf8'));
    expect(saved.cookies[0].name).toBe('x');
  });

  test('checkpoints on session:destroyed', async () => {
    await register(mockApp, ctx, { profileDir: tmpDir });

    const mockContext = {
      storageState: jest.fn(async ({ path: p }) => {
        await fs.writeFile(p, JSON.stringify({ cookies: [], origins: [] }));
      }),
    };

    await events.emitAsync('session:created', { userId: 'user-3', context: mockContext });
    await events.emitAsync('session:destroyed', { userId: 'user-3', reason: 'test' });

    expect(mockContext.storageState).toHaveBeenCalled();
  });

  test('env var CAMOFOX_PROFILE_DIR overrides pluginConfig', async () => {
    const envDir = path.join(tmpDir, 'env-override');
    const orig = process.env.CAMOFOX_PROFILE_DIR;
    process.env.CAMOFOX_PROFILE_DIR = envDir;
    try {
      await register(mockApp, ctx, { profileDir: '/should/not/use' });
      expect(ctx.log).toHaveBeenCalledWith('info', 'persistence plugin enabled', { profileDir: envDir });
    } finally {
      if (orig === undefined) delete process.env.CAMOFOX_PROFILE_DIR;
      else process.env.CAMOFOX_PROFILE_DIR = orig;
    }
  });
});
