'use client';

import Image from 'next/image';
import { FilePreview } from '../file-preview';
import { useSession } from '@/lib/use-session';
import { ensureOk, errorMessage, readWebSession, clearWebSession, downloadFile, restoreWebSession } from '@/lib/api';
import { toast } from '@/lib/feedback';
import { ArrowLeft, Download, FileText, ImageIcon, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { API_URL, apiFetch, authHeaders, bearerHeaders, FileAsset, jsonOrThrow } from '@/lib/api';

type Session = { access: string };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LibraryPage() {
  const [session, setSession] = useSession();
  const [files, setFiles] = useState<FileAsset[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<FileAsset | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => { if (session) { void load(session.access); } }, [session]);

  async function load(access: string) {
    setLoading(true); setError('');
    try { setFiles(await jsonOrThrow<FileAsset[]>(await apiFetch('/files', { headers: authHeaders(access) }))); }
    catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }

  async function upload(input: FileList | null) {
    if (!session || !input?.length) return;
    setBusy(true); setError('');
    try {
      for (const file of Array.from(input)) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} exceeds the 20 MB limit.`);
        const form = new FormData(); form.append('upload', file);
        await jsonOrThrow(await apiFetch('/files', { method: 'POST', headers: bearerHeaders(session.access), body: form }));
      }
      await load(session.access);
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setBusy(false); if (picker.current) picker.current.value = ''; }
  }

  async function download(file: FileAsset) {
    if (!session) return;
    try { await downloadFile(file); }
    catch (e) { setError(errorMessage(e)); }
  }

  async function remove(file: FileAsset) {
    if (!session || !window.confirm(`Delete “${file.original_name}”?`)) return;
    try { const response = await apiFetch(`/files/${file.id}`, { method: 'DELETE', headers: bearerHeaders(session.access) });
    if (!response.ok) { setError('Could not delete file'); return; }
    await load(session.access); toast('File deleted.'); } catch(e) { setError(errorMessage(e)); }
  }

  if (!session) return <main className="boot-screen" role="status">Loading your account…<a href="/">Return to chat</a></main>;

  return <main className="management-page">
    <header className="management-header"><a href="/" className="management-back"><ArrowLeft size={17}/> Chat</a><div className="brand"><Image src="/uvms-logo.png" width={34} height={34} alt="UVMS"/><strong>UVMS <span>AI</span></strong><b>LIBRARY</b></div><button className="primary-small" onClick={() => picker.current?.click()} disabled={busy}><Plus size={15}/> {busy ? 'Uploading…' : 'Upload'}</button></header>
    <input ref={picker} type="file" multiple hidden onChange={e => upload(e.target.files)} />
    <section className="simple-shell">
      <div className="simple-hero"><small>YOUR FILES</small><h1>Library</h1><p>Files uploaded from Web or Mobile are available from the same UVMS AI account.</p></div>
      {error && <div className="error-box management-error">{errorMessage(error)}<button onClick={() => session && load(session.access)}>Retry</button><button aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></button></div>}
      <div className="library-grid">
        {files.map(file => <article className="library-card" key={file.id}>
          <div className="library-file-icon">{file.category === 'image' ? <ImageIcon size={20}/> : <FileText size={20}/>}</div>
          <div className="library-meta"><strong title={file.original_name}>{file.original_name}</strong><small>{file.category.toUpperCase()} · {formatBytes(file.size_bytes)}</small></div>
          <div className="library-actions"><button onClick={() => setPreview(file)} title="Preview">Preview</button><button onClick={() => download(file)} title="Download"><Download size={15}/></button><button onClick={() => remove(file)} title="Delete"><Trash2 size={15}/></button></div>
        </article>)}
        {loading && <div className="skeleton" role="status">Loading your files…</div>}{!loading && !error && !files.length && <div className="management-empty library-empty"><FileText size={30}/><strong>Your Library is empty</strong><span>Upload a PDF, document, spreadsheet, text file or image.</span></div>}
      </div>
    </section>
    {preview && <FilePreview file={preview} onClose={() => setPreview(null)}/>}
  </main>;
}
