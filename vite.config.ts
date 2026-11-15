import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { defineConfig, Plugin } from 'vite';

let build = 'dev';
try {
  build = execSync('git rev-parse --short HEAD').toString().trim();
} catch {}

/** The pacing bot (?bot=1) posts its report here when it finishes; it's written to bot-runs/. */
function botReports(): Plugin {
  return {
    name: 'bot-reports',
    configureServer(server) {
      server.middlewares.use('/__bot-report', (req, res) => {
        if (req.method !== 'POST') return void res.writeHead(405).end();
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          mkdirSync('bot-runs', { recursive: true });
          const name = `bot-runs/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
          writeFileSync(name, body);
          console.log(`[bot] report written to ${name}`);
          res.writeHead(204).end();
        });
      });
    },
  };
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(build) },
  plugins: [botReports()],
  // Cloud saves in dev: run deploy/cloud-server.py with CLOUD_PORT=8111 (see the README).
  server: { proxy: { '/api/cloud': 'http://127.0.0.1:8111' } },
});
