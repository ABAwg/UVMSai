const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');

function setup(fetch) {
  const values = new Map(); const events = []; const listeners = new Map();
  const storage = {getItem:key => values.get(key) || null, setItem:(key,value) => values.set(key,value), removeItem:key => values.delete(key)};
  const exports = {};
  const context = { exports, process:{env:{}}, sessionStorage:storage, localStorage:storage, window:{dispatchEvent:event => events.push(event.type),addEventListener:(name,handler)=>listeners.set(name,handler)}, Headers, FormData, Response, Event, fetch, setTimeout };
  const code = ts.transpileModule(fs.readFileSync('lib/api.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, context);
  const pair = access => ({access_token:access,user:{id:'qa',display_name:'QA'}});
  exports.saveWebSession(pair('old'));
  return {api:exports,events,pair,storage,dispatchStorage:(key,newValue)=>listeners.get('storage')?.({key,newValue})};
}
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

test('simultaneous and late 401 responses perform exactly one refresh', async () => {
  let rotations=0; let releaseLate;
  const late = new Promise(resolve => releaseLate=resolve);
  const {api,pair} = setup(async (url,init) => {
    if (url.endsWith('/auth/refresh')) { rotations++; await new Promise(resolve=>setTimeout(resolve,10)); return json(pair('new')); }
    if (init.headers.get('Authorization') === 'Bearer new') return json({ok:true});
    if (url.endsWith('/slow')) await late;
    return json({detail:'Invalid or expired token'},401);
  });
  const slow=api.apiFetch('/slow');
  await Promise.all([api.apiFetch('/me'),api.apiFetch('/chats'),api.apiFetch('/models')]);
  releaseLate(); assert.equal((await slow).status,200); assert.equal(rotations,1);
});

test('cookie restores session after page storage is empty and never stores refresh token', async () => {
  const {api,pair} = setup(async (url,init) => {assert.equal(init.credentials,'include'); return json({...pair('restored'),refresh_token:'must-not-store'});});
  api.clearWebSession(); await api.restoreWebSession();
  assert.equal(api.readWebSession().access,'restored'); assert.equal(api.readWebSession().refresh_token,undefined);
});

test('invalid refresh clears session and signals login', async () => {
  const {api,events} = setup(async()=>json({detail:'Invalid or expired refresh token'},401));
  assert.equal((await api.apiFetch('/me')).status,401);
  assert.equal(api.readWebSession(),null); assert.deepEqual(events,['uvms-auth-expired']);
});

test('network failure during refresh preserves session for retry', async () => {
  const {api} = setup(async()=>{throw new TypeError('Failed to fetch');});
  await assert.rejects(api.restoreWebSession(), /Check your connection/);
  assert.equal(api.readWebSession().access,'old');
});

test('logout cannot be undone by an in-flight refresh', async () => {
  let release; const pending=new Promise(resolve=>release=resolve);
  const {api,pair}=setup(async()=>{await pending;return json(pair('late'));});
  const refresh=api.restoreWebSession(); api.clearWebSession(); release();
  assert.equal(await refresh,null); assert.equal(api.readWebSession(),null);
});

test('all validation and token error shapes become plain user messages', async () => {
  const {api}=setup(async()=>json({}));
  assert.match(api.errorMessage('{"detail":"Invalid or expired token"}'), /sign in again/);
  await assert.rejects(api.jsonOrThrow(json({detail:[{msg:'validation',input:'private'}]},422)), /check the information/);
  assert.equal(api.errorMessage({secret:'hidden'},500),'The service is temporarily unavailable. Please try again.');
});

test('relative API URL is not prefixed twice', async () => {
  const {api}=setup(async url=>{assert.equal(url,'/api/v1/me');return json({});});
  await api.apiFetch('/api/v1/me');
});

test('explicit logout clears other tabs via a token-free storage notification', () => {
  const first=setup(async()=>json({})); const second=setup(async()=>json({}));
  first.api.broadcastWebLogout();
  assert.equal(first.api.readWebSession(),null);
  assert.equal(second.api.readWebSession().access,'old');
  const marker=first.storage.getItem('uvms-session-logout');
  assert.match(marker,/^\d+-/);
  assert.ok(!marker.includes('old'));
  second.dispatchStorage('uvms-session-logout',marker);
  assert.equal(second.api.readWebSession(),null);
  assert.deepEqual(second.events,['uvms-auth-expired']);
});
