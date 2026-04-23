import fs from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { launchServer } from '../../lib/launcher.js';
import { loadConfig } from '../../lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let serverProcess = null;
let serverPort = null;
let serverCookiesDir = null;

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((err) => {
        if (err) return reject(err);
        resolve(port);
      });
    });
  });
}

async function waitForServer(port, maxRetries = 30, interval = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) {
        return true;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`Server failed to start on port ${port} after ${maxRetries} attempts`);
}

async function startServer(port = 0, extraEnv = {}) {
  const usePort = port || await getAvailablePort();
  const cfg = loadConfig();
  const pluginDir = path.join(__dirname, '../..');
  serverCookiesDir = extraEnv.CAMOFOX_COOKIES_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'camofox-test-cookies-'));

  const log = {
    info: (msg) => { if (cfg.serverEnv.DEBUG_SERVER) console.log(msg); },
    error: (msg) => { if (cfg.serverEnv.DEBUG_SERVER) console.error(msg); },
  };

  serverProcess = launchServer({
    pluginDir,
    port: usePort,
    env: { ...cfg.serverEnv, DEBUG_RESPONSES: 'false', ENABLE_VNC: '0', CAMOFOX_COOKIES_DIR: serverCookiesDir, ...extraEnv },
    log,
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err);
  });

  serverPort = usePort;

  await waitForServer(usePort);

  console.log(`camofox-browser server started on port ${usePort}`);
  return usePort;
}

async function stopServer() {
  if (serverProcess) {
    return new Promise((resolve) => {
      const proc = serverProcess;
      const killTimer = setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
          proc.kill('SIGKILL');
        }
      }, 5000);

      proc.once('close', () => {
        clearTimeout(killTimer);
        if (serverProcess === proc) {
          serverProcess = null;
          serverPort = null;
        }
        const cookiesDir = serverCookiesDir;
        serverCookiesDir = null;
        if (cookiesDir) {
          fs.rm(cookiesDir, { recursive: true, force: true }).finally(resolve);
          return;
        }
        resolve();
      });

      proc.kill('SIGTERM');
    });
  }
}

function getServerUrl() {
  if (!serverPort) throw new Error('Server not started');
  return `http://localhost:${serverPort}`;
}

function getServerPort() {
  return serverPort;
}

export {
  startServer,
  stopServer,
  getServerUrl,
  getServerPort
};
