import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

let build = 'dev';
try {
  build = execSync('git rev-parse --short HEAD').toString().trim();
} catch {}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(build) },
  // Cloud saves in dev: run deploy/cloud-server.py with CLOUD_PORT=8111 (see the README).
  server: { proxy: { '/api/cloud': 'http://127.0.0.1:8111' } },
});
