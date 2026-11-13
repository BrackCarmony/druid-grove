import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

let build = 'dev';
try {
  build = execSync('git rev-parse --short HEAD').toString().trim();
} catch {}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(build) },
});
