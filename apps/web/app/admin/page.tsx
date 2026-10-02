'use client';

import Image from 'next/image';
import { useSession } from '@/lib/use-session';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Bot,
  Brain,
  Check,
  FileText,
  FolderKanban,
  MessageSquare,
  RefreshCw,
  Save,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { API_URL, apiFetch, authHeaders, jsonOrThrow } from '@/lib/api';

type UsageTotals = {requests:number;tokens:number;estimated_cost_usd:number;unknown_cost_requests:number;unknown_token_requests:number};
type UsageGroup = UsageTotals & {name:string};
type ProviderHealth = {name:string;provider:string;status:'available'|'unavailable'|'unknown';models:Record<string,string>;checked_at:string|null;last_error:{code:string;message:string;at:string}|null;rate_limits?:{model:string;at:number;status:number;headers:Record<string,string>}[];recent_errors?:{code:string;request_id:string;at:string}[]};
type Stats = {
  provider_usage: UsageTotals & {average_first_token_ms:number|null;by_model:UsageGroup[];by_provider:UsageGroup[];by_plan:UsageGroup[];top_users:UsageGroup[]};
  provider_health: ProviderHealth;
  users: number;
  chats: number;
  messages: number;
  files: number;
  projects: number;
  memories: number;
  usage_events: number;
  checkouts: number;
  audit_events: number;
  ai_models: number;
  ai_mode: string;
  billing_provider: string;
};

type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  role: 'user' | 'admin';
  is_active: boolean;
  created_at: string;
  plan_code: string;
  subscription_status: string;
};

type Plan = {
  code: string;
  name: string;
  monthly_price_cents: number;
  currency: string;
  limits: Record<string, number>;
  is_active: boolean;
};


type AiModel = {
  id: string;
  name: string;
  description: string;
  provider_model: string;
  routing_managed_by_env?: boolean;
  reasoning_effort: 'none' | 'low' | 'medium' | 'high';
  min_plan: 'free' | 'plus' | 'pro' | 'business';
  is_enabled: boolean;
  supports_web_search: boolean;
  supports_vision: boolean;
};

type AuditRow = {
  id: string;
  actor_user_id?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  created_at: string;
};

function sessionToken() {
  if (typeof window === 'undefined') return '';
  try { return JSON.parse(sessionStorage.getItem('uvms-session') || '{}').access || ''; } catch { return ''; }
}

export default function AdminPage() {
  const [session] = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [models, setModels] = useState<AiModel[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState('');
  const [token, setToken] = useState('');
  const [features, setFeatures] = useState<Record<string,boolean>>({});

  const load = useCallback(async (access: string) => {
    if (!access) { setError('Sign in with an admin account first.'); return; }
    setError('');
    try {
      const [statsData, userData, planData, modelData, auditData, featureData] = await Promise.all([
        jsonOrThrow<Stats>(await apiFetch(`${API_URL}/admin/stats`, { headers: authHeaders(access) })),
        jsonOrThrow<AdminUser[]>(await apiFetch(`${API_URL}/admin/users`, { headers: authHeaders(access) })),
        jsonOrThrow<Plan[]>(await apiFetch(`${API_URL}/admin/plans`, { headers: authHeaders(access) })),
        jsonOrThrow<AiModel[]>(await apiFetch(`${API_URL}/admin/models`, { headers: authHeaders(access) })),
        jsonOrThrow<AuditRow[]>(await apiFetch(`${API_URL}/admin/audit?limit=30`, { headers: authHeaders(access) })),
        apiFetch('/admin/ai-features').then(r=>jsonOrThrow<Record<string,boolean>>(r)),
      ]);
      setFeatures(featureData);
      setStats(statsData); setUsers(userData); setPlans(planData); setModels(modelData); setAudit(auditData);
    } catch (e) { setError(e instanceof Error ? e.message : 'Admin data failed to load'); }
  }, []);

  useEffect(() => { if (session) { setToken(session.access); void load(session.access); } }, [load, session]);

  const cards = useMemo(() => stats ? [
    [Users, 'Users', stats.users],
    [MessageSquare, 'Chats', stats.chats],
    [Bot, 'Messages', stats.messages],
    [FileText, 'Files', stats.files],
    [FolderKanban, 'Projects', stats.projects],
    [Brain, 'Memories', stats.memories],
    [Activity, 'Usage events', stats.usage_events],
    [Bot, 'AI models', stats.ai_models],
    [ShieldCheck, 'Checkouts', stats.checkouts],
  ] as const : [], [stats]);

  async function toggleFeature(name:string) {
    setSaving(`feature-${name}`); setError('');
    try {
      setFeatures(await jsonOrThrow<Record<string,boolean>>(await apiFetch(`/admin/ai-features/${name}`,{method:'PATCH',body:JSON.stringify({is_enabled:!features[name]})})));
      setNotice(`${name} availability updated.`);
    } catch(e) { setError(e instanceof Error ? e.message : 'Availability could not be updated.'); }
    finally { setSaving(''); }
  }

  async function changeUserPlan(user: AdminUser, planCode: string) {
    if (!token) return;
    setSaving(`user-${user.id}`); setNotice(''); setError('');
    try {
      await jsonOrThrow(await apiFetch(`${API_URL}/admin/users/${user.id}/subscription`, {
        method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ plan_code: planCode, status: 'active' }),
      }));
      setUsers(rows => rows.map(row => row.id === user.id ? { ...row, plan_code: planCode, subscription_status: 'active' } : row));
      setNotice(`${user.email} is now on ${planCode.toUpperCase()}.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Plan update failed'); }
    finally { setSaving(''); }
  }

  async function toggleUser(user: AdminUser) {
    if (!token) return;
    setSaving(`user-${user.id}`); setError('');
    try {
      const body = await jsonOrThrow<{ is_active: boolean }>(await apiFetch(`${API_URL}/admin/users/${user.id}`, {
        method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ is_active: !user.is_active }),
      }));
      setUsers(rows => rows.map(row => row.id === user.id ? { ...row, is_active: body.is_active } : row));
    } catch (e) { setError(e instanceof Error ? e.message : 'User update failed'); }
    finally { setSaving(''); }
  }

  function patchPlanLocal(code: string, patch: Partial<Plan>, limitPatch?: { key: string; value: number }) {
    setPlans(rows => rows.map(row => {
      if (row.code !== code) return row;
      const limits = limitPatch ? { ...row.limits, [limitPatch.key]: limitPatch.value } : row.limits;
      return { ...row, ...patch, limits };
    }));
  }

  async function savePlan(plan: Plan) {
    if (!token) return;
    setSaving(`plan-${plan.code}`); setError(''); setNotice('');
    try {
      const saved = await jsonOrThrow<Plan>(await apiFetch(`${API_URL}/admin/plans/${plan.code}`, {
        method: 'PATCH', headers: authHeaders(token),
        body: JSON.stringify({ name: plan.name, monthly_price_cents: plan.monthly_price_cents, currency: plan.currency, limits: plan.limits, is_active: plan.is_active }),
      }));
      setPlans(rows => rows.map(row => row.code === plan.code ? saved : row));
      setNotice(`${plan.name} plan saved.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Plan save failed'); }
    finally { setSaving(''); }
  }


  function patchModelLocal(id: string, patch: Partial<AiModel>) {
    setModels(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  }

  async function checkProvider() {
    setSaving('provider-check'); setError('');
    try {
      const health = await jsonOrThrow<ProviderHealth>(await apiFetch('/admin/provider-health/check', {method:'POST', headers:authHeaders(token)}));
      setStats(current => current ? {...current, provider_health:health} : current);
    } catch (e) { setError(e instanceof Error ? e.message : 'Provider check failed'); }
    finally { setSaving(''); }
  }

  async function saveModel(model: AiModel) {
    if (!token) return;
    setSaving(`model-${model.id}`); setError(''); setNotice('');
    try {
      const saved = await jsonOrThrow<AiModel>(await apiFetch(`${API_URL}/admin/models/${model.id}`, {
        method: 'PATCH', headers: authHeaders(token),
        body: JSON.stringify({
          name: model.name, description: model.description, provider_model: model.provider_model,
          reasoning_effort: model.reasoning_effort, min_plan: model.min_plan, is_enabled: model.is_enabled,
          supports_web_search: model.supports_web_search, supports_vision: model.supports_vision,
        }),
      }));
      setModels(rows => rows.map(row => row.id === model.id ? saved : row));
      setNotice(`${model.name} configuration saved.`);
      const latestAudit = await jsonOrThrow<AuditRow[]>(await apiFetch(`${API_URL}/admin/audit?limit=30`, { headers: authHeaders(token) }));
      setAudit(latestAudit);
    } catch (e) { setError(e instanceof Error ? e.message : 'Model save failed'); }
    finally { setSaving(''); }
  }

  if (!session) return <main className="boot-screen" role="status">Loading your account…<a href="/">Return to chat</a></main>;

  return (
    <main className="admin-page management-page">
      <header className="management-header admin-control-header">
        <a className="management-back" href="/"><ArrowLeft size={17}/> Back to chat</a>
        <div className="brand"><Image src="/uvms-logo.png" width={36} height={36} alt="UVMS"/><strong>UVMS <span>AI</span></strong><b>ADMIN</b></div>
        <button className="primary-small" onClick={() => load(token)}><RefreshCw size={14}/> Refresh</button>
      </header>

      <section className="admin-content admin-control-content">
        <div className="admin-heading-row">
          <div><div className="beta-badge">CONTROL CENTER · STAGE 1 v1.0</div><h1>Platform control center</h1><p className="muted">Users, subscriptions, plan limits and live platform numbers.</p></div>
          {stats && <div className={`provider-state ${stats.ai_mode}`}><span/><div><small>AI PROVIDER</small><strong>{stats.provider_health?.name || stats.ai_mode.toUpperCase()}</strong></div></div>}
        </div>
        {error && <div className="error-box">{error}</div>}
        {notice && <div className="success-box"><Check size={15}/>{notice}</div>}

        {stats && <div className="admin-grid">{cards.map(([Icon,label,value]) => <article key={label}><Icon size={22}/><span>{label}</span><strong>{value}</strong></article>)}</div>}

        {stats?.provider_health && <section className="settings-card provider-diagnostic" aria-label="Provider diagnostic">
          <h2>{stats.provider_health.name}: {stats.provider_health.status === 'unknown' ? 'not checked recently' : stats.provider_health.status}</h2>
          <p>Models: {Object.entries(stats.provider_health.models).map(([mode,model])=>`${mode}: ${model}`).join(' · ')}</p>
          <p>{stats.provider_health.checked_at ? `Last request: ${new Date(stats.provider_health.checked_at).toLocaleString()}` : 'No provider request recorded.'} Availability reflects the latest provider request within 15 minutes.</p>
          {stats.provider_health.last_error && <p role="status">Last error: {stats.provider_health.last_error.message} ({stats.provider_health.last_error.code}) · {new Date(stats.provider_health.last_error.at).toLocaleString()}</p>}
          {stats.provider_health.rate_limits?.map(row => <div key={row.model}><h3>{row.model} · HTTP {row.status}</h3><p>Quota snapshot: {new Date(row.at * 1000).toLocaleString()}</p><dl>{Object.entries(row.headers).map(([name,value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></div>)}
          {!!stats.provider_health.recent_errors?.length && <details><summary>Recent provider errors</summary>{stats.provider_health.recent_errors.map((row,index) => <p key={row.request_id || index}>{row.code} · {row.request_id} · {new Date(row.at).toLocaleString()}</p>)}</details>}
          <button className="secondary-small" onClick={checkProvider} disabled={saving === 'provider-check'}>{saving === 'provider-check' ? 'Checking…' : 'Check provider'}</button>
        </section>}
        <section className="settings-card provider-controls"><h2>AI availability</h2><p>Server controls apply immediately. Open clients refresh availability when focused or within 30 seconds.</p><div className="data-actions">{Object.entries(features).map(([name,enabled])=><button key={name} className="secondary-small" aria-label={`Toggle ${name}`} aria-pressed={enabled} disabled={stats?.provider_health?.provider === 'gemini' || (stats?.provider_health?.provider === 'groq' && name !== 'voice') || saving===`feature-${name}`} onClick={()=>toggleFeature(name)}>{name}: {enabled?'Enabled':'Disabled'}</button>)}</div></section>
        {stats?.provider_usage && <section className="settings-card provider-accounting"><h2>Provider usage today (UTC)</h2><div className="provider-stats-grid"><article><span>Requests today</span><strong>{stats.provider_usage.requests}</strong></article><article><span>Reported tokens today</span><strong>{stats.provider_usage.tokens.toLocaleString()}</strong></article><article><span>Known estimated cost (USD)</span><strong>${stats.provider_usage.estimated_cost_usd.toFixed(6)}</strong></article><article><span>Average first token</span><strong>{stats.provider_usage.average_first_token_ms===null?'Not measured':`${Math.round(stats.provider_usage.average_first_token_ms)} ms`}</strong></article></div><p>{stats.provider_usage.unknown_cost_requests} requests have unknown cost; {stats.provider_usage.unknown_token_requests} have incomplete token usage. Estimates use backend rates and are not provider invoices.</p>{(['by_provider','by_model','by_plan','top_users'] as const).map(group=><div key={group} className="usage-table"><h3>{group==='by_provider'?'Usage by provider':group==='by_model'?'Cost by model':group==='by_plan'?'Usage by plan':'Top users by reported tokens'}</h3><table><thead><tr><th>{group==='top_users'?'User':'Group'}</th><th>Requests</th><th>Tokens</th><th>Known cost (USD)</th><th>Unknown costs</th></tr></thead><tbody>{(stats.provider_usage[group] || []).map(row=><tr key={row.name}><td>{group==='top_users'?(users.find(u=>u.id===row.name)?.email||row.name):row.name === 'gemini' ? 'Gemini' : row.name === 'groq' ? 'Groq' : row.name}</td><td>{row.requests}</td><td>{row.tokens}</td><td>{row.estimated_cost_usd.toFixed(6)}</td><td>{row.unknown_cost_requests}</td></tr>)}</tbody></table>{!(stats.provider_usage[group] || []).length&&<p>No provider requests recorded today.</p>}</div>)}</section>}

        <div className="admin-section-title"><div><ShieldCheck size={18}/><div><strong>Plans & entitlements</strong><small>Changes apply without a new app release.</small></div></div></div>
        <div className="plan-editor-grid">
          {plans.map(plan => <article className="plan-editor-card" key={plan.code}>
            <div className="plan-editor-head"><div><small>{plan.code.toUpperCase()}</small><input value={plan.name} onChange={e => patchPlanLocal(plan.code, { name: e.target.value })}/></div><label className="switch-line"><input type="checkbox" checked={plan.is_active} onChange={e => patchPlanLocal(plan.code, { is_active: e.target.checked })}/><span>{plan.is_active ? 'Active' : 'Hidden'}</span></label></div>
            <div className="plan-price-row"><span>{plan.currency}</span><input type="number" min={0} value={(plan.monthly_price_cents / 100).toFixed(2)} onChange={e => patchPlanLocal(plan.code, { monthly_price_cents: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) })}/><small>/ month</small></div>
            <div className="limit-grid">
              {['messages_daily','web_search_daily','images_monthly','storage_mb','max_file_mb','deep_daily'].map(key => <label key={key}><span>{key.replaceAll('_',' ')}</span><input type="number" value={Number(plan.limits[key] ?? 0)} onChange={e => patchPlanLocal(plan.code, {}, { key, value: Number(e.target.value || 0) })}/></label>)}
            </div>
            <button className="primary-small plan-save" onClick={() => savePlan(plan)} disabled={saving === `plan-${plan.code}`}><Save size={14}/>{saving === `plan-${plan.code}` ? 'Saving…' : 'Save plan'}</button>
          </article>)}
        </div>

        <div className="admin-section-title"><div><Bot size={18}/><div><strong>AI models</strong><small>Provider routing, reasoning effort and entitlement level.</small></div></div><span>{models.length} configured</span></div>
        <div className="model-admin-grid">
          {models.map(model => <article className="model-admin-card" key={model.id}>
            <div className="model-admin-head"><div><small>{model.id}</small><input value={model.name} onChange={e => patchModelLocal(model.id, { name: e.target.value })}/></div><label className="switch-line"><input type="checkbox" checked={model.is_enabled} onChange={e => patchModelLocal(model.id, { is_enabled: e.target.checked })}/><span>{model.is_enabled ? 'Enabled' : 'Disabled'}</span></label></div>
            <textarea value={model.description} onChange={e => patchModelLocal(model.id, { description: e.target.value })} placeholder="Model description"/>
            <label><span>Provider model{model.routing_managed_by_env ? ' (backend configuration)' : ''}</span><input disabled={model.routing_managed_by_env} value={model.provider_model} onChange={e => patchModelLocal(model.id, { provider_model: e.target.value })}/></label>
            <div className="model-admin-row"><label><span>Reasoning</span><select disabled={model.routing_managed_by_env} value={model.reasoning_effort} onChange={e => patchModelLocal(model.id, { reasoning_effort: e.target.value as AiModel['reasoning_effort'] })}><option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label><span>Minimum plan</span><select value={model.min_plan} onChange={e => patchModelLocal(model.id, { min_plan: e.target.value as AiModel['min_plan'] })}><option value="free">Free</option><option value="plus">Plus</option><option value="pro">Pro</option><option value="business">Business</option></select></label></div>
            <div className="model-flags"><label><input type="checkbox" checked={model.supports_web_search} onChange={e => patchModelLocal(model.id, { supports_web_search: e.target.checked })}/> Web search</label><label><input type="checkbox" checked={model.supports_vision} onChange={e => patchModelLocal(model.id, { supports_vision: e.target.checked })}/> Vision</label></div>
            <button className="primary-small plan-save" onClick={() => saveModel(model)} disabled={saving === `model-${model.id}`}><Save size={14}/>{saving === `model-${model.id}` ? 'Saving…' : 'Save model'}</button>
          </article>)}
        </div>

        <div className="admin-section-title"><div><Activity size={18}/><div><strong>Recent audit log</strong><small>High-value configuration and billing events.</small></div></div><span>{stats?.audit_events ?? 0} total</span></div>
        <div className="audit-list">{audit.slice(0, 12).map(row => <div className="audit-row" key={row.id}><div><strong>{row.action}</strong><small>{row.target_type || 'system'} · {row.target_id || '—'}</small></div><time>{new Date(row.created_at).toLocaleString()}</time></div>)}{!audit.length && <p className="muted">No audit events yet.</p>}</div>

        <div className="admin-section-title"><div><Users size={18}/><div><strong>Users & subscriptions</strong><small>Grant plans or temporarily disable an account.</small></div></div><span>{users.length} loaded</span></div>
        <div className="admin-users-table">
          <div className="admin-users-row admin-users-head"><span>User</span><span>Role</span><span>Plan</span><span>Status</span><span>Account</span></div>
          {users.map(user => <div className="admin-users-row" key={user.id}>
            <div className="admin-user-id"><strong>{user.display_name}</strong><small>{user.email}</small></div>
            <span className={`role-pill ${user.role}`}>{user.role}</span>
            <select value={user.plan_code} disabled={saving === `user-${user.id}`} onChange={e => changeUserPlan(user, e.target.value)}>{plans.filter(p => p.is_active).map(plan => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</select>
            <span className="sub-status">{user.subscription_status}</span>
            <button className={`account-toggle ${user.is_active ? 'active' : 'disabled'}`} onClick={() => toggleUser(user)} disabled={saving === `user-${user.id}`}>{user.is_active ? 'Enabled' : 'Disabled'}</button>
          </div>)}
        </div>
      </section>
    </main>
  );
}
