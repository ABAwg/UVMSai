'use client';

import Image from 'next/image';
import { useSession } from '@/lib/use-session';
import { apiFetch, ensureOk, errorMessage, jsonOrThrow } from '@/lib/api';
import { toast } from '@/lib/feedback';
import { ArrowLeft, ExternalLink, Link2, MessageSquare, ShieldCheck, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type SharedChatRecord = {
  id: string;
  source_chat_id?: string | null;
  title: string;
  created_at: string;
  expires_at?: string | null;
  revoked_at?: string | null;
};

function dateLabel(raw?: string | null) {
  if (!raw) return '—';
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? '—' : value.toLocaleString();
}

export default function SharedLinksPage() {
  const [session] = useSession();
  const [rows, setRows] = useState<SharedChatRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError('');
    try {
      const result = await jsonOrThrow<SharedChatRecord[]>(await apiFetch(`/shares?include_revoked=${includeRevoked}`));
      setRows(result);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [includeRevoked, session]);

  useEffect(() => { if (session) void load(); }, [session, load]);

  const activeCount = useMemo(() => rows.filter(row => !row.revoked_at && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now())).length, [rows]);

  async function revoke(row: SharedChatRecord) {
    if (!session || row.revoked_at) return;
    setBusy(row.id); setError('');
    try {
      await ensureOk(await apiFetch(`/shares/${row.id}`, { method: 'DELETE' }));
      toast('Shared snapshot revoked.', 'success');
      await load();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(null); }
  }

  async function revokeAll() {
    if (!session || !activeCount || !window.confirm(`Revoke all ${activeCount} active shared conversation link${activeCount === 1 ? '' : 's'}?`)) return;
    setBusy('all'); setError('');
    try {
      await ensureOk(await apiFetch('/shares', { method: 'DELETE' }));
      toast('All active shared links were revoked.', 'success');
      await load();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(null); }
  }

  if (!session) return <main className="boot-screen" role="status">Loading your account…<a href="/">Return to chat</a></main>;

  return <main className="management-page shared-links-page">
    <header className="management-header">
      <a href="/" className="management-back"><ArrowLeft size={17}/> Chat</a>
      <div className="brand"><Image src="/uvms-logo.png" width={34} height={34} alt="UVMS"/><strong>UVMS <span>AI</span></strong><b>SHARES</b></div>
      <div className="share-page-header-actions">
        <label className="history-toggle"><input type="checkbox" checked={includeRevoked} onChange={event => setIncludeRevoked(event.target.checked)}/><span>Show revoked</span></label>
        <button className="danger-outline" disabled={!activeCount || busy === 'all'} onClick={revokeAll}><Trash2 size={14}/> {busy === 'all' ? 'Revoking…' : 'Revoke all'}</button>
      </div>
    </header>

    <section className="simple-shell shares-shell">
      <div className="simple-hero shares-hero">
        <small>PRIVACY CONTROL</small>
        <h1>Shared conversations</h1>
        <p>UVMS AI shares immutable snapshots. Your private conversation can keep changing without changing a public snapshot, and you can revoke access at any time.</p>
        <div className="shares-summary"><span><Link2 size={15}/><strong>{activeCount}</strong> active</span><span><ShieldCheck size={15}/> Tokens are hashed at rest</span></div>
      </div>

      {error && <div className="error-box management-error">{error}<button onClick={() => void load()}>Retry</button><button aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></button></div>}

      <div className="shares-list">
        {rows.map(row => {
          const expired = !!row.expires_at && new Date(row.expires_at).getTime() <= Date.now();
          const inactive = !!row.revoked_at || expired;
          return <article className={`share-record-card ${inactive ? 'inactive' : ''}`} key={row.id}>
            <div className="share-record-icon"><Link2 size={18}/></div>
            <div className="share-record-main">
              <div className="share-record-title"><strong>{row.title}</strong><span className={inactive ? 'share-status inactive' : 'share-status'}>{row.revoked_at ? 'Revoked' : expired ? 'Expired' : 'Active'}</span></div>
              <div className="share-record-meta"><span>Created {dateLabel(row.created_at)}</span>{row.expires_at && <span>Expires {dateLabel(row.expires_at)}</span>}</div>
              <p>{inactive ? 'This snapshot can no longer be opened with its original public link.' : 'The original bearer link cannot be recovered from the database; create a new share if you need a new copy of the URL.'}</p>
            </div>
            <div className="share-record-actions">
              {row.source_chat_id && <a href={`/?chat=${encodeURIComponent(row.source_chat_id)}`}><MessageSquare size={14}/> Source chat</a>}
              {!inactive && <button disabled={busy === row.id} onClick={() => void revoke(row)}><Trash2 size={14}/> {busy === row.id ? 'Revoking…' : 'Revoke'}</button>}
            </div>
          </article>;
        })}
        {loading && <div className="skeleton" role="status">Loading shared conversations…</div>}
        {!loading && !error && !rows.length && <div className="management-empty shares-empty"><ExternalLink size={30}/><strong>No shared conversations</strong><span>Open a chat and choose Share. UVMS AI will create a read-only snapshot you can revoke later.</span><a className="primary-small" href="/">Open chat</a></div>}
      </div>
    </section>
  </main>;
}
