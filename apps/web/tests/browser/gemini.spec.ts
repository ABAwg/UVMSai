// UI contract fixtures only. Live Gemini quality is recorded separately.
import { test, expect, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

async function account(page:Page) {
  const email = `gemini-qa-${randomUUID()}@example.com`;
  const response = await page.request.post('/api/v1/auth/register', {data:{email,password:'QA-browser-123',display_name:'Gemini QA'},headers:{'X-UVMS-Client':'web'}});
  expect(response.status()).toBe(201);
  await page.route('**/capabilities', async route => {
    const response = await route.fetch();
    await route.fulfill({json:{...await response.json(),provider:'gemini',ai_mode:'live',text_live:true,search:false,images:false,voice:false,images_mode:'unavailable',voice_mode:'unavailable'}});
  });
  await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
  return email;
}

test('Public Beta UI, unavailable tools and readable quota error with Retry', async ({page}) => {
  await account(page);
  await expect(page.locator('.status-pill')).toContainText('Public Beta');
  await expect(page.getByText('Work with documents',{exact:true})).toBeVisible();
  await expect(page.locator('.starter-grid')).not.toContainText('Search the web');
  await expect(page.getByTitle('Search is currently unavailable',{exact:true})).toBeDisabled();
  await expect(page.getByTitle('Images are currently unavailable',{exact:true})).toBeDisabled();
  await page.route('**/chat/stream', async route => {
    await route.fulfill({status:200, contentType:'text/event-stream', body:'event: error\ndata: {"code":"rate_limit","message":"The AI quota is temporarily exhausted. Please try again later."}\n\n'});
  });
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('READY');
  await page.getByTitle('Send message',{exact:true}).click();
  await expect(page.locator('.inline-error')).toContainText('quota is temporarily exhausted');
  await expect(page.getByTitle('Stop generation',{exact:true})).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('"code":');
  await page.unroute('**/chat/stream');
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.locator('.message.assistant')).toContainText('Welcome to the UVMS AI demo.');
});

test('Admin displays Gemini diagnostic and configuration-owned routing', async ({page}) => {
  const email = await account(page);
  const root = path.resolve(__dirname,'../../../..');
  execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',"import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute('UPDATE users SET role=? WHERE email=?',('admin',sys.argv[2])); db.commit(); db.close()",path.join(root,'.qa/browser.db'),email]);
  const health = {name:'Gemini',provider:'gemini',status:'unavailable',models:{fast:'gemini-3.8-flash',balanced:'gemini-3.8-flash',deep:'gemini-3.8-flash'},checked_at:new Date().toISOString(),last_error:{code:'rate_limit',message:'The AI quota is temporarily exhausted. Please try again later.',at:new Date().toISOString()}};
  await page.route('**/admin/stats', async route => {
    const response = await route.fetch();
    await route.fulfill({json:{...await response.json(),provider_health:health}});
  });
  await page.route('**/admin/models', async route => {
    const response = await route.fetch();
    await route.fulfill({json:(await response.json()).map((row:any)=>({...row,provider_model:'gemini-3.8-flash',reasoning_effort:row.id.endsWith('fast')?'low':row.id.endsWith('deep')?'high':'medium',routing_managed_by_env:true}))});
  });
  await page.route('**/admin/provider-health/check', route => route.fulfill({json:{...health,status:'available'}}));
  await page.goto('/admin');
  const diagnostic = page.getByRole('region',{name:'Provider diagnostic'});
  await expect(diagnostic).toContainText('Gemini: unavailable');
  await expect(diagnostic).toContainText('gemini-3.8-flash');
  await expect(diagnostic).toContainText('quota is temporarily exhausted');
  await expect(page.locator('.model-admin-card').first().getByLabel('Provider model (backend configuration)')).toBeDisabled();
  await expect(page.locator('.model-admin-card').first().getByLabel('Reasoning')).toBeDisabled();
  await diagnostic.getByRole('button',{name:'Check provider'}).click();
  await expect(diagnostic).toContainText('Gemini: available');
});
