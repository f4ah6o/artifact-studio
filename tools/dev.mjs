import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const children = [];
let stopping = false;

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options,
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`${command} failed to start: ${error.message}`);
    shutdown(1);
  });
  child.on('exit', (code) => {
    if (!stopping && code !== 0) shutdown(code ?? 1);
  });
  return child;
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 50).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const apiPort = process.env.API_PORT || '3000';
const opaApiPort = process.env.OPA_API_PORT || '3001';
const daguApiPort = process.env.DAGU_API_PORT || '3002';
start(process.execPath, ['--watch', 'src/server/http-server.js'], {
  env: {
    ...process.env,
    PORT: apiPort,
    AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH || './audit/bpmn-generator.jsonl',
  },
});

start(process.execPath, ['--watch', 'src/server/opa-http-server.js'], {
  env: {
    ...process.env,
    OPA_API_PORT: opaApiPort,
  },
});

start(process.execPath, ['--watch', 'src/server/dagu-http-server.js'], {
  env: {
    ...process.env,
    DAGU_API_PORT: daguApiPort,
  },
});

start('vp', ['dev'], {
  env: { ...process.env, OPA_API_PORT: opaApiPort, DAGU_API_PORT: daguApiPort },
});
