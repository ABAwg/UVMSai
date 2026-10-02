'use client';

import Image from 'next/image';
import { defaults, Preferences, readPreferences, savePreferences } from '@/lib/preferences';
import { useSession } from '@/lib/use-session';
import { ensureOk, errorMessage, readWebSession, broadcastWebLogout, downloadFile, restoreWebSession } from '@/lib/api';
import { toast } from '@/lib/feedback';
import { ArrowLeft, Download, KeyRound, LogOut, MonitorSmartphone, Save, Shield, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL, apiFetch, authHeaders, bearerHeaders, jsonOrThrow, User } from '@/lib/api';

type Session = { access: string; user: User };
type DeviceSession = { id: string; user_agent?: string | null; ip_address?: string | null; created_at: string; expires_at: string; revoked_at?: string | null };

export default function SettingsPage() {
  const [session, setSession] = useSession();
  const [name, setName] = useState('');
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [prefs, setPrefs] = useState<Preferences>(defaults);
  const [models, setModels] = useState<Array<{id:string;name:string;available:boolean;tier:string}>>([]);
  const [usage, setUsage] = useState<{plan_name:string;today:{messages:number};limits:{messages_daily:number}} | null>(null);
  const [busy, setBusy] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  useEffect(() => { setPrefs(readPreferences()); }, []);
  useEffect(() => { if (!session) return; Promise.all([apiFetch('/models').then(r => jsonOrThrow<typeof models>(r)), apiFetch('/usage/me').then(r => jsonOrThrow<NonNullable<typeof usage>>(r))]).then(([rows, snapshot]) => { setModels(rows); setUsage(snapshot); }).catch(e => setError(errorMessage(e))); }, [session]);
  function updatePrefs(patch: Partial<Preferences>) { const next = {...prefs, ...patch}; setPrefs(next); savePreferences(next); toast('Preferences saved on this browser.'); }
  async function signOut() { try { await ensureOk(await apiFetch('/auth/logout', {method:'POST',body:'{}'})); broadcastWebLogout(); location.assign('/'); } catch(e) { setError(errorMessage(e)); } }

  useEffect(() => { if (session) { setName(session.user.display_name); setProfileReady(true); void loadDevices(session.access); } }, [session]);

  async function loadDevices(access: string) {
    try { setDevices(await jsonOrThrow<DeviceSession[]>(await apiFetch('/me/sessions', { headers: authHeaders(access) }))); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load sessions'); }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault(); if (!session || busy) return; setBusy(true); setError(''); setMessage('');
    try {
      const user = await jsonOrThrow<User>(await apiFetch('/me', { method: 'PATCH', headers: authHeaders(session.access), body: JSON.stringify({ display_name: name }) }));
      const next = { ...(readWebSession() || session), user }; sessionStorage.setItem('uvms-session', JSON.stringify(next)); setSession(next); setMessage('Profile updated.');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault(); if (!session || busy) return; setBusy(true); setError(''); setMessage('');
    try {
      const response = await apiFetch('/me/password', { method: 'POST', headers: authHeaders(session.access), body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
      await ensureOk(response);
      broadcastWebLogout(); setMessage('Password changed. Other sessions were signed out.');
      setTimeout(() => { window.location.href = '/'; }, 1200);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (!session) return;
    try { const response = await apiFetch(`/me/sessions/${id}`, { method: 'DELETE', headers: bearerHeaders(session.access) });
    if (!response.ok) { setError('Could not revoke session'); return; }
    await loadDevices(session.access); toast('Session revoked.'); } catch(e) { setError(errorMessage(e)); }
  }

  async function logoutAll() {
    if (!session || !window.confirm('Sign out all devices?')) return;
    try { await ensureOk(await apiFetch('/me/logout-all', { method: 'POST', headers: bearerHeaders(session.access) }));
    broadcastWebLogout(); window.location.href = '/'; } catch(e) { setError(errorMessage(e)); }
  }

  async function exportData() {
    if (!session) return;
    try {
      const response = await apiFetch('/me/export', { headers: bearerHeaders(session.access) });
      if (!response.ok) throw new Error('Export failed');
      const data = await response.json();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'uvms-ai-data-export.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed'); }
  }

  async function deleteAccount() {
    if (!session) return;
    const confirmation = window.prompt('This permanently deletes your UVMS AI account and data. Type DELETE to continue.');
    if (confirmation !== 'DELETE') return;
    try { const response = await apiFetch('/me', { method: 'DELETE', headers: bearerHeaders(session.access) });
    if (!response.ok) { setError('Could not delete account'); return; }
    broadcastWebLogout(); window.location.href = '/'; } catch(e) { setError(errorMessage(e)); }
  }

  if (!session || !profileReady) return <main className="boot-screen" role="status">Loading your account…<a href="/">Return to chat</a></main>;

  return <main className="management-page">
    <header className="management-header"><a href="/" className="management-back"><ArrowLeft size={17}/> Chat</a><div className="brand"><Image src="/uvms-logo.png" width={34} height={34} alt="UVMS"/><strong>UVMS <span>AI</span></strong><b>SETTINGS</b></div><span/></header>
    <section className="simple-shell settings-shell">
      <div className="simple-hero"><small>ACCOUNT & SECURITY</small><h1>Settings</h1><p>Manage your shared Web/Mobile identity, security sessions and personal data.</p></div>
      {error && <div className="error-box management-error">{errorMessage(error)}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></button></div>}
      {message && <div className="success-box">{message}</div>}

      <div className="settings-grid">
        <section className="settings-card"><div className="settings-title"><strong>Account & plan</strong></div><p>{session?.user.email}</p><p>{usage ? `${usage.plan_name} · ${usage.today.messages} / ${usage.limits.messages_daily} messages today` : 'Loading usage…'}</p><a className="secondary-small" href="/billing">Plan and usage</a><button className="secondary-small" onClick={signOut}>Logout</button></section>
        <section className="settings-card"><div className="settings-title"><strong>Appearance</strong></div><p>UVMS dark · preferences saved on this browser.</p><label>Message size<select value={prefs.textSize} onChange={e => updatePrefs({textSize:e.target.value as Preferences['textSize']})}><option value="standard">Standard</option><option value="large">Large</option></select></label><label>Animations<select value={prefs.motion} onChange={e => updatePrefs({motion:e.target.value as Preferences['motion']})}><option value="system">Follow system preference</option><option value="reduced">Reduced motion</option></select></label></section>
        <section className="settings-card"><div className="settings-title"><strong>AI preferences</strong></div><label>Default model<select value={prefs.model} onChange={e => updatePrefs({model:e.target.value})}>{models.map(model => <option key={model.id} value={model.id} disabled={!model.available}>{model.name}{model.available ? '' : ` · ${model.tier} required`}</option>)}</select></label><label className="check-label"><input type="checkbox" checked={prefs.search} onChange={e => updatePrefs({search:e.target.checked})}/> Start new visits with web search enabled</label></section>
        <section className="settings-card"><div className="settings-title"><strong>Memory</strong></div><p>Manage the facts and preferences used across your conversations. Only enabled memories are included.</p><a className="secondary-small" href="/memory">Manage memory</a></section>
      </div>
      <div className="settings-grid">
        <section className="settings-card"><div className="settings-title"><Shield size={19}/><div><strong>Profile</strong><small>{session?.user.email}</small></div></div><form onSubmit={saveProfile}><label>Display name<input value={name} onChange={e => setName(e.target.value)} required minLength={1} maxLength={120}/></label><button className="primary-small" disabled={busy}><Save size={14}/> Save profile</button></form></section>
        <section className="settings-card"><div className="settings-title"><KeyRound size={19}/><div><strong>Change password</strong><small>You will be signed out on every device.</small></div></div><form onSubmit={changePassword}><label>Current password<input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required minLength={8}/></label><label>New password<input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8}/></label><button className="primary-small" disabled={busy}>Update password</button></form></section>
      </div>

      <section className="settings-card settings-wide"><div className="settings-title"><MonitorSmartphone size={19}/><div><strong>Signed-in sessions</strong><small>Revoke devices you no longer use.</small></div><button className="secondary-small" onClick={logoutAll}><LogOut size={13}/> Sign out all</button></div><div className="session-list">{devices.map(device => <div className="session-row" key={device.id}><div><strong>{device.user_agent || 'Unknown device'}</strong><small>{device.ip_address || 'Unknown IP'} · {new Date(device.created_at).toLocaleString()}</small></div><span className={device.revoked_at ? 'session-revoked' : 'session-active'}>{device.revoked_at ? 'Revoked' : new Date(device.expires_at) < new Date() ? 'Expired' : 'Active'}</span>{!device.revoked_at && <button onClick={() => revoke(device.id)}>Revoke</button>}</div>)}</div></section>

      <section className="settings-card settings-wide"><div className="settings-title"><Download size={19}/><div><strong>Your data</strong><small>Export your account data as JSON or permanently remove the account.</small></div></div><div className="data-actions"><button className="secondary-small" onClick={exportData}><Download size={14}/> Export data</button><button className="danger-small" onClick={deleteAccount}><Trash2 size={14}/> Delete account</button></div></section>
    </section>
  </main>;
}
