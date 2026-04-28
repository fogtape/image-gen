import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';

const root = new URL('../', import.meta.url);
const imageTag = process.env.IMAGE_GEN_DOCKER_SMOKE_TAG || `image-gen:smoke-${process.pid}`;
const requireDocker = process.env.CI === 'true' || process.env.REQUIRE_DOCKER_SMOKE === '1';

function log(message) {
  console.log(`[docker-smoke] ${message}`);
}

function skip(message) {
  if (requireDocker) {
    console.error(`[docker-smoke] ${message}`);
    process.exit(1);
  }
  log(`SKIP: ${message}`);
  process.exit(0);
}

function runDocker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
  });
  if (result.error?.code === 'ENOENT') {
    skip('docker command not found');
  }
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`docker ${args.join(' ')} failed${output ? `\n${output}` : ''}`);
  }
  return result.stdout?.trim() || '';
}

function ensureDockerAvailable() {
  const result = spawnSync('docker', ['info'], { encoding: 'utf8', stdio: 'pipe' });
  if (result.error?.code === 'ENOENT') {
    skip('docker command not found');
  }
  if (result.status !== 0) {
    skip('docker daemon is not available');
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address?.port;
      server.close(() => {
        if (!port) reject(new Error('failed to allocate a local port'));
        else resolve(port);
      });
    });
  });
}

function getText(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) {
          req.destroy(new Error('response exceeded smoke-test limit'));
        }
      });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(2000, () => req.destroy(new Error(`timeout fetching ${url}`)));
    req.on('error', reject);
  });
}

async function waitForHttp(url, validate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await getText(url);
      validate(response);
      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error(`timed out waiting for ${url}`);
}

function startContainer(port) {
  const child = spawn('docker', [
    'run',
    '--rm',
    '-p',
    `127.0.0.1:${port}:3000`,
    imageTag,
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  child.on('error', (error) => {
    if (error.code === 'ENOENT') skip('docker command not found');
  });
  return { child, getLogs: () => logs.trim() };
}

async function stopContainer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

ensureDockerAvailable();
log(`building ${imageTag}`);
runDocker(['build', '-t', imageTag, '.'], { stdio: 'inherit' });

const port = await getFreePort();
const container = startContainer(port);

try {
  const baseUrl = `http://127.0.0.1:${port}`;
  log(`waiting for ${baseUrl}`);
  await waitForHttp(`${baseUrl}/`, ({ statusCode, body }) => {
    if (statusCode !== 200) throw new Error(`GET / returned ${statusCode}`);
    if (!body.includes('<!DOCTYPE html') || !body.includes('app.js')) {
      throw new Error('GET / did not return the expected frontend shell');
    }
  });
  await waitForHttp(`${baseUrl}/frontend/state.js`, ({ statusCode, body }) => {
    if (statusCode !== 200) throw new Error(`GET /frontend/state.js returned ${statusCode}`);
    if (!body.includes('export const state')) {
      throw new Error('frontend ES module was not served correctly');
    }
  });
  await waitForHttp(`${baseUrl}/api/config/runtime`, ({ statusCode, headers, body }) => {
    if (statusCode !== 200) throw new Error(`GET /api/config/runtime returned ${statusCode}`);
    if (!String(headers['content-type'] || '').includes('application/json')) {
      throw new Error('runtime config did not return JSON');
    }
    JSON.parse(body);
  });
  log('PASS');
} catch (error) {
  const logs = container.getLogs();
  if (logs) console.error(`[docker-smoke] container logs:\n${logs}`);
  throw error;
} finally {
  await stopContainer(container.child);
  runDocker(['image', 'rm', imageTag], { stdio: 'ignore' });
}
