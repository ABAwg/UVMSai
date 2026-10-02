'use client';

import Image from 'next/image';
import { useSession } from '@/lib/use-session';
import { ensureOk, errorMessage, readWebSession, clearWebSession, downloadFile, restoreWebSession } from '@/lib/api';
import { toast } from '@/lib/feedback';
import { ArrowLeft, Brain, Plus, Power, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL, apiFetch, authHeaders, bearerHeaders, jsonOrThrow } from '@/lib/api';

type Session = { access: string };
type MemoryItem = { id: string; content: string; is_enabled: boolean; source: string; created_at: string; updated_at: string };

export default function MemoryPage() {
  const [session, setSession] = useSession();
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (session) { void load(session.access); } }, [session]);

  async function load(access: string) {
    setLoading(true); setError('');
    try { setItems(await jsonOrThrow<MemoryItem[]>(await apiFetch(`${API_URL}/memory`, { headers: authHeaders(access) }))); }
    catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }

  async function addMemory(e: React.FormEvent) {
    e.preventDefault(); if (!session || !content.trim() || busy) return;
    setBusy(true);
    try {
      await jsonOrThrow(await apiFetch(`${API_URL}/memory`, { method: 'POST', headers: authHeaders(session.access), body: JSON.stringify({ content: content.trim() }) }));
      setContent(''); await load(session.access);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function toggle(item: MemoryItem) {
    if (!session) return;
    try { await jsonOrThrow(await apiFetch(`${API_URL}/memory/${item.id}`, { method: 'PATCH', headers: authHeaders(session.access), body: JSON.stringify({ is_enabled: !item.is_enabled }) })); await load(session.access); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update memory'); }
  }

  async function remove(item: MemoryItem) {
    if (!session || !window.confirm('Delete this memory?')) return;
    try { const res = await apiFetch(`${API_URL}/memory/${item.id}`, { method: 'DELETE', headers: bearerHeaders(session.access) });
    if (!res.ok) { setError('Could not delete memory'); return; }
    await load(session.access); toast('Memory deleted.'); } catch(e) { setError(errorMessage(e)); }
  }

  if (!session) return <main className="boot-screen" role="status">Loading your account…<a href="/">Return to chat</a></main>;

  return (
    <main className="management-page">
      <header className="management-header"><a href="/" className="management-back"><ArrowLeft size={17}/> Chat</a><div className="brand"><Image src="/uvms-logo.png" width={34} height={34} alt="UVMS"/><strong>UVMS <span>AI</span></strong><b>MEMORY</b></div><span/></header>
      <section className="memory-shell">
        <div className="memory-hero"><div className="memory-icon"><Brain size={28}/></div><small>PERSONAL CONTEXT</small><h1>Memory</h1><p>Saved facts can be used across conversations when relevant. You control each item and can disable or delete it at any time.</p></div>
        {error && <div className="error-box management-error">{errorMessage(error)}<button onClick={() => session && load(session.access)}>Retry</button><button aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></button></div>}
        <form className="memory-composer" onSubmit={addMemory}><textarea aria-label="Memory to add" value={content} onChange={e => setContent(e.target.value)} placeholder="Add something UVMS AI should remember…" rows={3}/><button className="primary-small" disabled={busy || !content.trim()}><Plus size={15}/> Add memory</button></form>
        <div className="memory-list">
          {items.map(item => <article key={item.id} className={`memory-card ${item.is_enabled ? '' : 'disabled'}`}><div className="memory-status"><Power size={15}/><span>{item.is_enabled ? 'Active' : 'Disabled'}</span></div><p>{item.content}</p><div className="memory-actions"><button onClick={() => toggle(item)}>{item.is_enabled ? 'Disable' : 'Enable'}</button><button className="danger-text" onClick={() => remove(item)}><Trash2 size={13}/> Delete</button></div></article>)}
          {loading && <div className="skeleton" role="status">Loading memory…</div>}{!loading && !error && !items.length && <div className="management-empty memory-empty"><Brain size={28}/><strong>No saved memory yet</strong><span>Add a preference, ongoing goal or useful context above.</span></div>}
        </div>
      </section>
    </main>
  );
}
