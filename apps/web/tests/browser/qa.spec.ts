import { test, expect, Page } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

async function account(page: Page) {
  const email=`qa-${randomUUID()}@example.com`;
  const response=await page.request.post('/api/v1/auth/register',{data:{email,password:'QA-browser-123',display_name:'QA Tester'},headers:{'X-UVMS-Client':'web'}});
  expect(response.status()).toBe(201);
  await page.goto('/');
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible();
  return email;
}
async function expireAccess(page: Page) {
  const raw=await page.evaluate(()=>sessionStorage.getItem('uvms-session'));
  const session=JSON.parse(raw!); const [header,payload]=session.access.split('.');
  const claims=JSON.parse(Buffer.from(payload,'base64url').toString()); claims.exp=Math.floor(Date.now()/1000)-5;
  const body=`${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const signature=createHmac('sha256','qa-only-isolated-server-key-not-for-deployment').update(body).digest('base64url');
  session.access=`${body}.${signature}`;
  await page.evaluate(value=>sessionStorage.setItem('uvms-session',value),JSON.stringify(session));
}
async function send(page:Page,text:string) {
  await page.getByRole('textbox',{name:'Message',exact:true}).fill(text);
  await page.getByTitle('Send message',{exact:true}).click();
  await expect(page.locator('.message.assistant').last()).toContainText('Welcome to the UVMS AI demo.');
  await expect(page.getByTitle('Stop generation',{exact:true})).toHaveCount(0);
}

test('session recovery, refresh deduplication, reload, logout and login',async({page,context})=>{
  const email=await account(page);
  expect(await page.evaluate(()=>document.cookie)).not.toContain('uvms_refresh');
  let refreshes=0; page.on('request',request=>{if(request.url().endsWith('/auth/refresh')) refreshes++;});
  await expireAccess(page); await page.reload();
  await expect(page.locator('.profile-mini')).toContainText('QA Tester');
  await expect.poll(()=>refreshes).toBe(1);
  await send(page,'Expired token recovery');
  await page.reload(); await expect(page.locator('.message.assistant')).toHaveCount(1);
  await page.evaluate(()=>sessionStorage.removeItem('uvms-session')); await page.reload();
  await expect(page.locator('.profile-mini')).toContainText('QA Tester');
  await page.route('**/auth/logout',async route=>{await route.fulfill({status:503,json:{detail:'Temporarily unavailable'}});await page.unroute('**/auth/logout');});
  await page.getByTitle('Sign out',{exact:true}).click();
  await expect(page.locator('.inline-error')).toContainText('temporarily unavailable');
  await expect(page.locator('.profile-mini')).toBeVisible();
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await page.getByPlaceholder('Email',{exact:true}).fill(email);
  await page.getByPlaceholder('Password (8+ chars)').fill('QA-browser-123');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible();
  await expireAccess(page); await context.clearCookies(); await page.reload();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await expect(page.locator('body')).not.toContainText('{"detail"');
});

test('browser Back and Forward restore chat and new-chat views',async({page})=>{
  await account(page);
  await send(page,'History first conversation');
  const firstUrl=page.url();
  await page.getByRole('button',{name:/New chat/}).click();
  await expect(page.locator('.messages')).toHaveCount(0);
  await send(page,'History second conversation');
  const secondUrl=page.url();
  expect(secondUrl).not.toBe(firstUrl);
  await page.goBack();
  await expect(page.locator('.messages')).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('.message.user')).toContainText('History first conversation');
  await page.goForward();
  await expect(page.locator('.messages')).toHaveCount(0);
  await page.goForward();
  await expect(page.locator('.message.user')).toContainText('History second conversation');
});

test('rapid duplicate Send creates one persisted user message',async({page})=>{
  await account(page);
  let streamPosts=0;
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/v1/chat/stream')) streamPosts++;});
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Double Send QA');
  await page.evaluate(()=>{
    const button=document.querySelector<HTMLButtonElement>('[title="Send message"]');
    button?.click(); button?.click();
  });
  await expect(page.locator('.message.assistant')).toContainText('Welcome to the UVMS AI demo.');
  await expect(page.getByTitle('Stop generation',{exact:true})).toHaveCount(0);
  expect(streamPosts).toBe(1);
  await page.reload();
  await expect(page.locator('.message.user')).toHaveCount(1);
});

test('chat lifecycle and management pages have real outcomes',async({page})=>{
  const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('401')) errors.push(message.text());});
  await account(page); await send(page,'Lifecycle QA');
  await expect(page.locator('.chat-title')).toContainText('Lifecycle QA');
  await page.getByTitle('Regenerate',{exact:true}).click();
  await expect(page.getByTitle('Regenerate',{exact:true})).toBeEnabled();
  await page.getByTitle('Edit',{exact:true}).click();
  await page.locator('.message-editor textarea').fill('Edited lifecycle');
  await page.getByRole('button',{name:'Save & regenerate'}).click();
  await expect(page.locator('.message.user')).toContainText('Edited lifecycle');
  await page.getByTitle('Copy',{exact:true}).first().click();
  await expect(page.getByText('Copied to clipboard.',{exact:true})).toBeVisible();
  await page.getByTitle('Actions for Lifecycle QA').click();
  page.once('dialog',dialog=>dialog.accept('Renamed QA'));
  await page.getByTitle('Rename',{exact:true}).click();
  await expect(page.locator('.chat-title')).toContainText('Renamed QA');
  await page.getByTitle('Actions for Renamed QA').click(); await page.getByTitle('Archive',{exact:true}).click();
  await expect(page.locator('.chat-title')).toHaveCount(0);
  await page.getByRole('button',{name:/Archived chats/}).click();
  await expect(page.locator('.chat-title')).toContainText('Renamed QA');
  await page.getByTitle('Actions for Renamed QA').click(); await page.getByTitle('Restore',{exact:true}).click();
  await page.getByRole('button',{name:/Back to chats/}).click();
  await page.getByPlaceholder('Search chats').fill('Renamed'); await expect(page.locator('.chat-title')).toHaveCount(1);
  await page.getByTitle('Account settings').click();
  await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
  await page.getByLabel('Display name').fill('Updated QA'); await page.getByRole('button',{name:'Save profile'}).click();
  await expect(page.getByText('Profile updated.',{exact:true})).toBeVisible();
  await page.getByLabel('Message size').selectOption('large');
  await expect(page.locator('html')).toHaveAttribute('data-text-size','large');
  const download=page.waitForEvent('download'); await page.getByRole('button',{name:'Export data'}).click(); expect((await download).suggestedFilename()).toContain('export.json');
  await page.getByRole('link',{name:'Manage memory'}).click();
  await page.locator('.memory-composer textarea').fill('I prefer metric units.'); await page.getByRole('button',{name:'Add memory'}).click();
  await expect(page.locator('.memory-card')).toContainText('Active');
  await page.getByRole('button',{name:'Disable',exact:true}).click(); await expect(page.locator('.memory-card')).toContainText('Disabled');
  await page.getByRole('button',{name:'Enable',exact:true}).click(); await expect(page.locator('.memory-card')).toContainText('Active');
  await page.goto('/projects'); await page.getByRole('button',{name:'New project',exact:true}).click();
  await page.getByLabel('Project name').fill('Launch QA'); await page.getByLabel('Project instructions').fill('Use metric units.');
  await page.getByRole('button',{name:'Create project',exact:true}).click(); await expect(page.getByRole('heading',{name:'Launch QA'})).toBeVisible();
  await page.getByRole('button',{name:'Edit',exact:true}).click(); await page.getByLabel('Description',{exact:true}).fill('Updated description');
  await page.getByRole('button',{name:'Save changes'}).click(); await expect(page.getByText('Updated description').last()).toBeVisible();
  await expect(page.locator('input[type=file]')).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles({name:'project-notes.txt',mimeType:'text/plain',buffer:Buffer.from('Project context QA')});
  await expect(page.getByText('project-notes.txt',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'New chat',exact:true}).click(); await send(page,'Project conversation'); await expect(page.locator('.project-pill')).toContainText('Launch QA');
  await page.getByTitle('Leave project').click(); await expect(page.locator('.project-pill')).toHaveCount(0); await expect(page.locator('.messages')).toHaveCount(0);
  await page.goto('/library'); await expect(page.getByText('project-notes.txt',{exact:true})).toBeVisible();
  await page.getByTitle('Preview',{exact:true}).click(); await expect(page.locator('.preview-body')).toContainText('Project context QA'); await page.getByLabel('Close preview').click();
  expect(errors).toEqual([]);
});

for (const [width,height] of [[1920,1080],[1366,768],[820,1180],[390,844]]) {
  test(`responsive controls and screenshot ${width}x${height}`,async({page})=>{
    await page.setViewportSize({width,height}); await account(page);
    expect(await page.locator('.conversation').evaluate(element=>element.scrollTop)).toBe(0);
    if(width<=900) { await page.getByTitle('Open sidebar').click(); await expect(page.locator('.sidebar')).toBeVisible(); await page.locator('.mobile-scrim').click({position:{x:width-10,y:height/2}}); }
    await expect(page.getByTitle('Send message')).toBeVisible();
    await page.getByRole('button',{name:/Search the web Fresh/}).click(); await expect(page.locator('.composer-mode-bar')).toContainText('Web search');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth); expect(overflow).toBe(false);
    await page.screenshot({path:`../../.qa/viewport-${width}.png`,fullPage:true});
  });
}

test('Stop finalizes accounting after the browser disconnects',async({page})=>{
  await account(page);
  const stream=page.waitForResponse('**/api/v1/chat/stream');
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Cancel during visible streaming');
  await page.getByTitle('Send message',{exact:true}).click();
  const response = await stream;
  const requestId = response.headers()['x-uvms-request-id'];
  expect(requestId).toBeTruthy();
  await expect(page.locator('.message.assistant .message-text')).not.toBeEmpty();
  await page.getByTitle('Stop generation',{exact:true}).click();
  await expect(page.getByTitle('Stop generation',{exact:true})).toHaveCount(0);
  const root=path.resolve(__dirname,'../../../..');
  const code="import sqlite3,json,sys; db=sqlite3.connect(sys.argv[1]); rows=db.execute(\"select meta from usage_events where kind='provider.request'\").fetchall(); print(next((json.loads(r[0])['status'] for r in rows if json.loads(r[0]).get('request_id')==sys.argv[2] and json.loads(r[0]).get('chat_id')==sys.argv[3]),'missing'))";
  const chatId=new URL(page.url()).searchParams.get('chat');
  expect(chatId).toBeTruthy();
  await expect.poll(()=>execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',code,path.join(root,'.qa/browser.db'),requestId,chatId!],{encoding:'utf8'}).trim()).toBe('cancelled');
});

test('chat stream renders progressively through the Next proxy',async({page})=>{
  await account(page);
  await page.evaluate(()=>{
    const state={lengths:[] as number[],whileGenerating:false};
    (window as any).__streamQA=state;
    const observer=new MutationObserver(()=>{
      const text=document.querySelector('.message.assistant .message-text')?.textContent||'';
      if(text.length && state.lengths.at(-1)!==text.length){
        state.lengths.push(text.length);
        if(document.querySelector('[title="Stop generation"]')) state.whileGenerating=true;
      }
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  });
  const stream=page.waitForResponse('**/api/v1/chat/stream');
  await send(page,'Progressive browser stream regression');
  const response=await stream;
  expect(response.headers()['cache-control']).toContain('no-transform');
  expect(response.headers()['content-encoding']).toBeUndefined();
  const state=await page.evaluate(()=>(window as any).__streamQA);
  expect(state.lengths.length).toBeGreaterThan(1);
  expect(state.whileGenerating).toBe(true);
});

test('voice recording uses transcription endpoint and supports cancel',async({page})=>{
  await account(page);
  await page.getByTitle('Voice input',{exact:true}).click(); await expect(page.getByTitle('Stop recording',{exact:true})).toBeVisible();
  await expect(page.locator('.runtime-strip')).toContainText('Recording 0:01');
  await page.getByRole('button',{name:'Cancel recording'}).click(); await expect(page.getByTitle('Voice input',{exact:true})).toBeVisible();
  await page.route('**/audio/transcribe',route=>route.fulfill({json:{text:'Transcribed QA message',demo:false}}));
  await page.getByTitle('Voice input',{exact:true}).click(); await expect(page.getByTitle('Stop recording',{exact:true})).toBeVisible();
  await page.waitForTimeout(350); await page.getByTitle('Stop recording',{exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Transcribed QA message');
  await expect(page.locator('.message.user')).toHaveCount(0);
});

test('failed chat has no empty assistant and Retry succeeds',async({page})=>{
  await account(page);
  await page.locator('input[type=file]').setInputFiles({name:'retry-once.txt',mimeType:'text/plain',buffer:Buffer.from('Upload only once')});
  let uploads=0;
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/v1/files')) uploads++;});
  await page.route('**/chat/stream',async route=>{await route.fulfill({status:503,json:{detail:'Provider failure'}}); await page.unroute('**/chat/stream');});
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Retry QA'); await page.getByTitle('Send message').click();
  await expect(page.locator('.inline-error')).toContainText('temporarily unavailable');
  await expect(page.locator('.message.assistant')).toHaveCount(0);
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.locator('.message.assistant')).toContainText('Welcome to the UVMS AI demo.');
  expect(uploads).toBe(1);
});

test('attachments, demo image download, model restrictions and deletion',async({page})=>{
  await account(page);
  await page.locator('.model-button').click();
  await expect(page.getByRole('button',{name:/UVMS-1 Deep/})).toBeDisabled();
  await page.getByRole('button',{name:/UVMS-1 Fast Quick|UVMS-1 Fast Fast/}).click();
  await page.reload(); await expect(page.locator('.model-button')).toContainText('Fast');
  await page.locator('input[type=file]').setInputFiles({name:'composer-qa.txt',mimeType:'text/plain',buffer:Buffer.from('Attached QA document')});
  await expect(page.locator('.pending-file')).toContainText('composer-qa.txt');
  await page.getByTitle('Remove',{exact:true}).click(); await expect(page.locator('.pending-file')).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles({name:'composer-qa.txt',mimeType:'text/plain',buffer:Buffer.from('Attached QA document')});
  await send(page,'Summarize my attachment');
  await expect(page.locator('.attachment-card')).toContainText('composer-qa.txt');
  const fileDownload=page.waitForEvent('download'); await page.locator('.attachment-card').click(); expect((await fileDownload).suggestedFilename()).toBe('composer-qa.txt');
  await page.getByRole('button',{name:/New chat/}).click();
  await page.getByRole('button',{name:/Create images Turn/}).click();
  await page.getByTitle('Send message').click();
  await expect(page.locator('.message.assistant')).toContainText('UVMS demo image');
  await expect(page.locator('.secure-generated-image')).toBeVisible();
  const imageDownload=page.waitForEvent('download'); await page.getByTitle('Download image').click(); expect((await imageDownload).suggestedFilename()).toMatch(/\.png$/);
  await page.locator('.chat-menu-trigger').first().click(); page.once('dialog',dialog=>dialog.accept()); await page.getByTitle('Delete',{exact:true}).click();
  await expect(page.locator('.chat-title')).toHaveCount(1);
  await page.goto('/library'); const card=page.locator('.library-card').filter({hasText:'composer-qa.txt'});
  page.once('dialog',dialog=>dialog.accept()); await card.getByTitle('Delete',{exact:true}).click(); await expect(card).toHaveCount(0);
});

test('voice denial and unsupported recording have visible errors',async({page})=>{
  await account(page);
  await page.evaluate(()=>{MediaRecorder.isTypeSupported=()=>false;});
  await page.getByTitle('Voice input',{exact:true}).click(); await expect(page.locator('.inline-error')).toContainText('no supported recording codec');
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});
  await page.getByTitle('Voice input',{exact:true}).click(); await expect(page.locator('.inline-error')).toContainText('permission was denied');
  await page.evaluate(()=>{Object.defineProperty(window,'MediaRecorder',{value:undefined,configurable:true});});
  await page.getByTitle('Voice input',{exact:true}).click(); await expect(page.locator('.inline-error')).toContainText('unavailable in this browser');
});

test('settings logout-all and password change revoke sessions',async({page})=>{
  const email=await account(page);
  await page.goto('/settings'); await expect(page.getByLabel('Display name')).toHaveValue('QA Tester');
  await page.getByLabel('Current password',{exact:true}).fill('QA-browser-123'); await page.getByLabel('New password',{exact:true}).fill('QA-browser-updated-456');
  await page.getByRole('button',{name:'Update password'}).click(); await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await page.getByPlaceholder('Email',{exact:true}).fill(email); await page.getByPlaceholder('Password (8+ chars)').fill('QA-browser-updated-456');
  await page.getByRole('button',{name:'Sign in',exact:true}).click(); await expect(page.getByPlaceholder('Ask anything...')).toBeVisible();
  await page.goto('/settings'); page.once('dialog',dialog=>dialog.accept()); await page.getByRole('button',{name:'Sign out all',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
});

test('memory and project deletion, account deletion and reduced motion',async({page})=>{
  await account(page);
  await page.goto('/settings'); await page.getByLabel('Animations').selectOption('reduced');
  await expect(page.locator('html')).toHaveAttribute('data-motion','reduced');
  await page.goto('/memory'); await page.locator('.memory-composer textarea').fill('Disposable memory'); await page.getByRole('button',{name:'Add memory'}).click();
  await expect(page.locator('.memory-card')).toHaveCount(1); page.once('dialog',dialog=>dialog.accept()); await page.getByRole('button',{name:'Delete',exact:true}).click(); await expect(page.locator('.memory-card')).toHaveCount(0);
  await page.goto('/projects'); await page.getByRole('button',{name:'New project',exact:true}).click(); await page.getByLabel('Project name').fill('Disposable project'); await page.getByRole('button',{name:'Create project',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Disposable project'})).toBeVisible(); page.once('dialog',dialog=>dialog.accept()); await page.getByTitle('Delete project').click(); await expect(page.locator('.project-list-item')).toHaveCount(0);
  await page.goto('/settings'); page.once('dialog',dialog=>dialog.accept('DELETE')); await page.getByRole('button',{name:'Delete account'}).click(); await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
});

test('stop generation, unsupported uploads, safe citations and upward scroll',async({page})=>{
  await account(page);
  await page.locator('input[type=file]').setInputFiles({name:'unsupported.exe',mimeType:'application/octet-stream',buffer:Buffer.from('QA')}); await expect(page.locator('.inline-error')).toContainText('unsupported file type');
  for (let i=0;i<3;i++) await send(page,`Conversation context ${i}`);
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep streaming while I read earlier messages.'); await page.getByTitle('Send message').click();
  await expect(page.getByTitle('Stop generation',{exact:true})).toBeVisible();
  await page.locator('.conversation').evaluate(element=>{element.scrollTop=0;element.dispatchEvent(new Event('scroll',{bubbles:true}));});
  await expect(page.getByTitle('Stop generation',{exact:true})).toHaveCount(0);
  expect(await page.locator('.conversation').evaluate(element=>element.scrollTop)).toBe(0);
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Stop this answer'); await page.getByTitle('Send message').click();
  await page.getByTitle('Stop generation',{exact:true}).click(); await expect(page.getByTitle('Stop generation',{exact:true})).toHaveCount(0);
  await expect(page.locator('.message.assistant').filter({hasText:/^$/})).toHaveCount(0);
  const chatUrl=page.url();
  await page.route('**/api/v1/chats/*',async route=>{
    if(route.request().method()!=='GET') {await route.continue();return;}
    const response=await route.fetch(); const body=await response.json();
    if(!Array.isArray(body.messages)) {await route.fulfill({response});return;}
    body.messages.push({id:'citation-qa',role:'assistant',content:'Safe source QA',created_at:new Date().toISOString(),meta:{citations:[{url:'javascript:alert(1)',title:'Unsafe source'},{url:'https://example.com/qa',title:'Safe source'}]}});
    await route.fulfill({json:body});
  });
  await page.goto(chatUrl); await expect(page.getByRole('link',{name:/Safe source/})).toHaveAttribute('href','https://example.com/qa'); await expect(page.getByRole('link',{name:/Unsafe source/})).toHaveCount(0);
  await page.locator('.conversation').evaluate(element=>{element.scrollTop=0;element.dispatchEvent(new Event('scroll',{bubbles:true}));});
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Draft without jumping');
  expect(await page.locator('.conversation').evaluate(element=>element.scrollTop)).toBe(0);
});

test('demo billing activates plan and survives reload',async({page})=>{
  await account(page); await page.goto('/billing');
  await expect(page.getByText('Live payments are not available in this beta.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Choose Plus',exact:true}).click();
  await page.getByRole('button',{name:'Complete demo payment',exact:true}).click();
  await expect(page.locator('.current-plan')).toContainText('Plus');
  await page.reload(); await expect(page.locator('.current-plan')).toContainText('Plus');
  await page.screenshot({path:'../../.qa/billing.png',fullPage:true});
});

test('late transcription and image result do not replace a new chat',async({page})=>{
  await account(page);
  let releaseAudio!:()=>void;
  const heldAudio=new Promise<void>(resolve=>{releaseAudio=resolve;});
  await page.route('**/audio/transcribe',async route=>{await heldAudio; await route.fulfill({json:{text:'Old conversation transcript',demo:false}});});
  await page.getByTitle('Voice input',{exact:true}).click(); await expect(page.getByTitle('Stop recording',{exact:true})).toBeVisible();
  await page.waitForTimeout(350);
  const audioRequest=page.waitForRequest('**/audio/transcribe');
  await page.getByTitle('Stop recording',{exact:true}).click(); await audioRequest;
  await page.getByRole('button',{name:/New chat/}).click(); releaseAudio();
  await expect(page.getByTitle('Voice input',{exact:true})).toBeEnabled();
  await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('');
  let releaseImage!:()=>void;
  const heldImage=new Promise<void>(resolve=>{releaseImage=resolve;});
  await page.route('**/images/generate',async route=>{const result=await route.fetch();await heldImage;await route.fulfill({response:result});});
  await page.getByRole('button',{name:/Create images Turn/}).click();
  const imageRequest=page.waitForRequest('**/images/generate'); await page.getByTitle('Send message').click();await imageRequest;
  await page.getByRole('button',{name:/New chat/}).click();releaseImage();
  await expect(page.locator('.chat-title')).toHaveCount(1);
  await expect(page.locator('.messages')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('chat')).toBe(false);
});

test('admin controls persist changes and deny ordinary users',async({page,browser})=>{
  const email=await account(page);
  const normal=await page.request.get('/api/v1/admin/stats',{headers:{Authorization:`Bearer ${await page.evaluate(()=>JSON.parse(sessionStorage.getItem('uvms-session')!).access)}`}});
  expect(normal.status()).toBe(403);
  // Promote only this disposable account in the explicitly isolated QA SQLite database.
  const root=path.resolve(__dirname,'../../../..');
  execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',"import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute('UPDATE users SET role=? WHERE email=?',('admin',sys.argv[2])); db.commit(); db.close()",path.join(root,'.qa/browser.db'),email]);
  const secondary=await browser.newContext({baseURL:new URL(page.url()).origin});
  try {
    const target=await account(await secondary.newPage());
    await page.goto('/admin'); await expect(page.locator('.admin-grid')).toBeVisible();
    await expect(page.getByRole('heading',{name:'Provider usage today (UTC)'})).toBeVisible();
    for (const feature of ['search','images','voice']) {
      const toggle=page.getByRole('button',{name:`Toggle ${feature}`,exact:true});
      await expect(toggle).toHaveAttribute('aria-pressed','true');await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed','false');
      const userPage=secondary.pages()[0]; await userPage.reload();
      const disabledTitle=feature==='search'?'Search is currently unavailable':feature==='images'?'Images are currently unavailable':'Voice is currently unavailable';
      await expect(userPage.getByTitle(disabledTitle,{exact:true})).toBeDisabled();
      await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');
    }
    const plan=page.locator('.plan-editor-card').first(); await plan.getByRole('button',{name:'Save plan'}).click();
    await expect(page.locator('.success-box')).toContainText('plan saved');
    const model=page.locator('.model-admin-card').first(); await model.getByRole('button',{name:'Save model'}).click();
    await expect(page.locator('.success-box')).toContainText('configuration saved');
    const user=page.locator('.admin-users-row').filter({hasText:target});
    await user.locator('select').selectOption('plus'); await expect(page.locator('.success-box')).toContainText('PLUS');
    await user.getByRole('button',{name:'Enabled',exact:true}).click(); await expect(user.getByRole('button',{name:'Disabled',exact:true})).toBeEnabled();
    await user.getByRole('button',{name:'Disabled',exact:true}).click(); await expect(user.getByRole('button',{name:'Enabled',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Refresh',exact:true}).click(); await expect(user.locator('select')).toHaveValue('plus');
    await expect(page.locator('.audit-list')).toContainText('model');
    await page.screenshot({path:'../../.qa/admin.png',fullPage:true});
  } finally { await secondary.close(); }
});
