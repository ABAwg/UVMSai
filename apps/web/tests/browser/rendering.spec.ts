import { test, expect, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function signIn(page: Page) {
  const response = await page.request.post('/api/v1/auth/register', {data:{email:`render-${randomUUID()}@example.com`,password:'Browser-QA-only-123',display_name:'Rendering QA'},headers:{'X-UVMS-Client':'web'}});
  expect(response.status()).toBe(201);
  await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
}

test('rich messages escape XSS and render charts, math, highlighted code at mobile width',async({page})=>{
  await signIn(page);
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Rendering fixture');
  await page.getByTitle('Send message',{exact:true}).click();
  await expect(page.locator('.message.assistant')).toContainText('Welcome to the UVMS AI demo.');
  await expect(page.getByTitle('Stop generation',{exact:true})).toHaveCount(0);
  const specs = [
    {type:'line',title:'Signed line',data:[{label:'A',value:-4},{label:'B',value:12}]},
    {type:'bar',title:'Long category names',data:[{label:'Very long category name for accessibility',value:1e9},{label:'Small negative',value:-.001}]},
    {type:'pie',title:'Shares',data:[{label:'One',value:30},{label:'Two',value:70}]},
    {type:'scatter',title:'Coordinates',data:[{label:'A',x:1,y:2},{label:'B',x:2,y:5}]},
  ];
  const content = '<img src=x onerror="window.__qaXss=1">\n\n[Unsafe](javascript:alert(1))\n\n\\(x^2+\\frac{1}{2}\\)\n\n```python\nprint("<script>alert(1)</script>")\n```\n\n'+specs.map(s=>'```chart\n'+JSON.stringify(s)+'\n```').join('\n\n')+'\n\n| A | B |\n|---|---|\n| 1 | 2 |';
  await page.route('**/api/v1/chats/*',async route=>{
    if(route.request().method()!=='GET'){await route.continue();return;}
    const response=await route.fetch();const body=await response.json();
    if(body.messages)body.messages[body.messages.length-1].content=content;
    await route.fulfill({json:body});
  });
  await page.reload();
  await expect(page.locator('.chart-card')).toHaveCount(4);
  await expect(page.locator('.katex')).toHaveCount(1);
  expect(await page.locator('.hljs-string').count()).toBeGreaterThan(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__qaXss)).toBeUndefined();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('.chart-card').last().scrollIntoViewIfNeeded();
  await page.screenshot({path:'../../.qa/rich-rendering-mobile.png'});
});

test('file preview supports keyboard activation, modal focus and Escape',async({page})=>{
  await signIn(page);await page.goto('/library');
  await page.locator('input[type=file]').setInputFiles({name:'keyboard-preview.txt',mimeType:'text/plain',buffer:Buffer.from('Accessible preview content')});
  const preview=page.getByRole('button',{name:'Preview',exact:true});await expect(preview).toBeVisible();
  await preview.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog).toContainText('Accessible preview content');
  expect(await page.evaluate(()=>!!document.activeElement?.closest('dialog'))).toBe(true);
  await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('dialog'))).toBe(true);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(preview).toBeFocused();
});

test('two tabs concurrently send separate chats without crossing histories',async({page,context})=>{
  await signIn(page);
  const second=await context.newPage();await second.goto('/');
  await expect(second.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
  const send=async(tab:Page,prompt:string)=>{
    await tab.getByRole('textbox',{name:'Message',exact:true}).fill(prompt);
    await tab.getByTitle('Send message',{exact:true}).click();
    await expect(tab.locator('.message.assistant')).toContainText('Welcome to the UVMS AI demo.');
    await expect(tab.getByTitle('Stop generation',{exact:true})).toHaveCount(0);
    await tab.reload();await expect(tab.locator('.message.user')).toHaveCount(1);
    await expect(tab.locator('.message.user .message-text')).toHaveText(prompt);
  };
  await Promise.all([send(page,'Concurrent tab A'),send(second,'Concurrent tab B')]);
  expect(page.url()).not.toBe(second.url());
  await expect(page.locator('.chat-row')).toHaveCount(2);
  await second.close();
});
