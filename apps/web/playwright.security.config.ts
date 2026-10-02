import { defineConfig } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(__dirname, '../..');
const qa = path.join(root, '.qa');
fs.mkdirSync(qa, { recursive: true });
const webPort = 3120;
const apiPort = 8020;
const baseURL = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './tests/security', timeout: 80000, workers: 1, retries: 0,
  reporter: [['list']], outputDir: '../../.qa/security-browser-results',
  use: { baseURL, headless: true, channel: 'chrome', screenshot: 'only-on-failure' },
  webServer: [
    { command: `"${path.join(root, '.venv/Scripts/python.exe')}" -m uvicorn app.main:app --host 127.0.0.1 --port ${apiPort}`,
      cwd: path.join(root, 'services/api'), url: `http://127.0.0.1:${apiPort}/live`, reuseExistingServer: false, timeout: 60000,
      env: { UVMS_DATABASE_URL: `sqlite:///${path.join(qa, 'security-browser.db').replaceAll('\\', '/')}`,
        UVMS_STORAGE_DIR: path.join(qa, 'security-storage'), OPENAI_API_KEY: '', UVMS_AI_PROVIDER: 'demo', UVMS_SMTP_HOST: '',
        UVMS_ENV: 'development', UVMS_JWT_SECRET: 'qa-only-isolated-security-key-not-for-deployment',
        UVMS_CORS_ORIGINS: baseURL, UVMS_RATE_LIMIT_AUTH_PER_MINUTE: '1000' } },
    { command: `node node_modules/next/dist/bin/next dev -p ${webPort}`, cwd: path.join(root, 'apps/web'), url: baseURL,
      reuseExistingServer: false, timeout: 120000,
      env: { NEXT_PUBLIC_API_URL: '/api/v1', UVMS_API_INTERNAL_URL: `http://127.0.0.1:${apiPort}` } },
  ],
});
