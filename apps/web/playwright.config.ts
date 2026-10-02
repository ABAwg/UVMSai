import { defineConfig } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(__dirname, '../..');
const qa = path.join(root, '.qa'); fs.mkdirSync(qa, {recursive:true});
const webPort = Number(process.env.UVMS_E2E_WEB_PORT || 3100);
const apiPort = Number(process.env.UVMS_E2E_API_PORT || 8001);
if (![webPort, apiPort].every(port => Number.isInteger(port) && port > 0 && port < 65536) || webPort === apiPort) throw new Error('Use distinct valid E2E Web/API ports.');
const baseURL = `http://localhost:${webPort}`;
export default defineConfig({
  testDir: './tests/browser', timeout: 60000, workers: 1, retries: 0,
  reporter: [['list'], ['html', {outputFolder:'../../.qa/browser-report',open:'never'}]],
  outputDir: '../../.qa/browser-results',
  use: {baseURL, headless:true, channel:'chrome', screenshot:'only-on-failure', trace:'off', launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}},
  webServer: [
    {command:`"${path.join(root,'.venv/Scripts/python.exe')}" tests/browser_server.py ${apiPort}`, cwd:path.join(root,'services/api'), url:`http://127.0.0.1:${apiPort}/live`, reuseExistingServer:false, timeout:60000,
      env:{UVMS_DATABASE_URL:`sqlite:///${path.join(qa,'browser.db').replaceAll('\\','/')}`,UVMS_STORAGE_DIR:path.join(qa,'storage'),OPENAI_API_KEY:'',OPENROUTER_API_KEY:'',GEMINI_API_KEY:'',GROQ_API_KEY:'',UVMS_AI_PROVIDER:'demo',UVMS_PUBLIC_BETA:'false',UVMS_SEARCH_ENABLED:'true',UVMS_IMAGES_ENABLED:'true',UVMS_VOICE_ENABLED:'true',UVMS_BILLING_PROVIDER:'demo',UVMS_PASSWORD_RESET_ENABLED:'true',UVMS_SMTP_HOST:'',UVMS_ENV:'development',UVMS_JWT_SECRET:'qa-only-isolated-server-key-not-for-deployment',UVMS_CORS_ORIGINS:baseURL,UVMS_RATE_LIMIT_AUTH_PER_MINUTE:'1000'}},
    {command:`node node_modules/next/dist/bin/next dev -p ${webPort}`,url:baseURL,reuseExistingServer:false,timeout:120000,env:{UVMS_E2E:'1',NEXT_PUBLIC_API_URL:'/api/v1',UVMS_API_INTERNAL_URL:`http://127.0.0.1:${apiPort}`}}
  ],
});
