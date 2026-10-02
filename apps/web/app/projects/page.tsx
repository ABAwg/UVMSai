'use client';

import Image from 'next/image';
import { FilePreview } from '../file-preview';
import { useSession } from '@/lib/use-session';
import { ensureOk, errorMessage, readWebSession, clearWebSession, downloadFile, restoreWebSession } from '@/lib/api';
import { toast } from '@/lib/feedback';
import { ArrowLeft, FileText, FolderKanban, MessageSquare, Plus, Rocket, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, apiFetch, authHeaders, bearerHeaders, Chat, FileAsset, jsonOrThrow } from '@/lib/api';

type Session = { access: string; user: { display_name: string } };
type Project = { id: string; name: string; description: string; instructions: string; created_at: string; updated_at: string };

function sessionFromStorage(): Session | null {
  try {
    const raw = sessionStorage.getItem('uvms-session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export default function ProjectsPage() {
  const [session, setSession] = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [files, setFiles] = useState<FileAsset[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<FileAsset | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState('');
  const projectVersion = useRef(0);

  const loadProjects = useCallback(async (access: string) => {
    setLoading(true);
    try {
      const rows = await jsonOrThrow<Project[]>(await apiFetch(`${API_URL}/projects`, { headers: authHeaders(access) }));
      setProjects(rows);
      if (selected) setSelected(rows.find(item => item.id === selected.id) || null);
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }, [selected]);

  useEffect(() => { if (session) { void loadProjects(session.access); } }, [session]);

  async function openProject(project: Project) {
    if (!session) return;
    const version = ++projectVersion.current;
    setSelected(project); setChats([]); setFiles([]); setError('');
    try {
      const [projectChats, projectFiles] = await Promise.all([
        apiFetch(`/projects/${project.id}/chats`).then(r => jsonOrThrow<Chat[]>(r)),
        apiFetch(`/projects/${project.id}/files`).then(r => jsonOrThrow<FileAsset[]>(r)),
      ]);
      if (version === projectVersion.current) { setChats(projectChats); setFiles(projectFiles); }
    } catch (e) { if (version === projectVersion.current) setError(errorMessage(e)); }
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const project = await jsonOrThrow<Project>(await apiFetch(editing ? `/projects/${editing}` : '/projects', {
        method: editing ? 'PATCH' : 'POST', headers: authHeaders(session.access),
        body: JSON.stringify({ name: name.trim(), description: description.trim(), instructions: instructions.trim() }),
      }));
      setName(''); setDescription(''); setInstructions(''); setCreating(false); setEditing(null); toast(editing ? 'Project updated.' : 'Project created.');
      await loadProjects(session.access); await openProject(project);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function deleteProject(project: Project) {
    if (!session || !window.confirm(`Delete “${project.name}”? Chats and files will stay in your account.`)) return;
    try { const res = await apiFetch(`${API_URL}/projects/${project.id}`, { method: 'DELETE', headers: bearerHeaders(session.access) });
    if (!res.ok) { setError('Could not delete project'); return; }
    if (selected?.id === project.id) { setSelected(null); setChats([]); setFiles([]); }
    const active = localStorage.getItem('uvms-active-project');
    if (active) { try { if (JSON.parse(active).id === project.id) localStorage.removeItem('uvms-active-project'); } catch {} }
    await loadProjects(session.access); toast('Project deleted.'); } catch(e) { setError(errorMessage(e)); }
  }

  async function uploadProjectFile(file?: File) {
    if (!file || !selected || busy) return;
    setBusy(true); setError('');
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('This file exceeds 20 MB.');
      const form = new FormData(); form.append('upload', file); form.append('project_id', selected.id);
      await jsonOrThrow(await apiFetch('/files', {method:'POST',body:form}));
      await openProject(selected); toast('File added to project context.');
    } catch(e) { setError(errorMessage(e)); } finally {setBusy(false);}
  }

  function startProjectChat(project: Project, chatId?: string) {
    localStorage.setItem('uvms-active-project', JSON.stringify({ id: project.id, name: project.name }));
    window.location.href = chatId ? `/?chat=${encodeURIComponent(chatId)}&project=${encodeURIComponent(project.id)}` : '/';
  }

  if (!session) return <main className="boot-screen" role="status">Loading your account…<a href="/">Return to chat</a></main>;

  return (
    <main className="management-page">
      <header className="management-header">
        <a href="/" className="management-back"><ArrowLeft size={17}/> Chat</a>
        <div className="brand"><Image src="/uvms-logo.png" width={34} height={34} alt="UVMS"/><strong>UVMS <span>AI</span></strong><b>PROJECTS</b></div>
        <button className="primary-small" onClick={() => { setEditing(null); setName(''); setDescription(''); setInstructions(''); setCreating(true); }}><Plus size={15}/> New project</button>
      </header>

      <section className="management-shell">
        <aside className="management-list">
          <div className="management-title"><div><small>WORKSPACE</small><h1>Projects</h1></div><FolderKanban size={24}/></div>
          <p className="management-muted">Keep chats, files and custom instructions together. Project instructions are automatically included in AI context.</p>
          <div className="project-list">
            {projects.map(project => <button key={project.id} className={`project-list-item ${selected?.id === project.id ? 'active' : ''}`} onClick={() => openProject(project)}><FolderKanban size={16}/><div><strong>{project.name}</strong><small>{project.description || 'No description'}</small></div></button>)}
            {loading && <div className="skeleton" role="status">Loading projects…</div>}{!loading && !error && !projects.length && <div className="management-empty">No projects yet. Create your first workspace.</div>}
          </div>
        </aside>

        <div className="management-detail">
          {error && <div className="error-box management-error">{errorMessage(error)}<button onClick={() => selected ? openProject(selected) : loadProjects(session.access)}>Retry</button><button aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></button></div>}
          {creating ? (
            <form className="project-editor" onSubmit={createProject}>
              <div className="editor-head"><div><small>NEW WORKSPACE</small><h2>{editing ? 'Edit project' : 'Create project'}</h2></div><button type="button" className="icon-btn" onClick={() => setCreating(false)}><X size={18}/></button></div>
              <label>Project name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. UVMS AI Public Beta" autoFocus required maxLength={140}/></label>
              <label>Description<textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this project for?" rows={3}/></label>
              <label>Project instructions<textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Instructions UVMS AI should follow inside this project…" rows={6}/></label>
              <button className="primary-btn" type="submit" disabled={busy}><Plus size={16}/> {busy ? 'Saving…' : editing ? 'Save changes' : 'Create project'}</button>
            </form>
          ) : selected ? (
            <div className="project-overview">
              <div className="project-hero">
                <div className="project-icon"><FolderKanban size={25}/></div>
                <div><small>PROJECT</small><h2>{selected.name}</h2><p>{selected.description || 'No project description yet.'}</p></div>
                <div className="project-hero-actions"><button className="secondary-small" onClick={() => {setEditing(selected.id);setName(selected.name);setDescription(selected.description);setInstructions(selected.instructions);setCreating(true);}}>Edit</button><button className="primary-small" onClick={() => startProjectChat(selected)}><Rocket size={15}/> New chat</button><button title="Delete project" className="danger-ghost" onClick={() => deleteProject(selected)}><Trash2 size={15}/></button></div>
              </div>
              {selected.instructions && <div className="project-instructions"><small>PROJECT INSTRUCTIONS</small><p>{selected.instructions}</p></div>}
              <div className="project-columns">
                <section><div className="section-head"><strong><MessageSquare size={15}/> Chats</strong><span>{chats.length}</span></div>{chats.map(chat => <button key={chat.id} className="project-resource" onClick={() => startProjectChat(selected, chat.id)}><MessageSquare size={15}/><div><strong>{chat.title}</strong><small>{chat.model_id}</small></div></button>)}{!chats.length && <div className="management-empty compact">No project chats yet.</div>}</section>
                <section><div className="section-head"><strong><FileText size={15}/> Files</strong><label className="secondary-small">{busy ? 'Uploading…' : 'Upload'}<input type="file" hidden disabled={busy} onChange={e => uploadProjectFile(e.target.files?.[0])}/></label><span>{files.length}</span></div>{files.map(file => <button key={file.id} className="project-resource" onClick={() => setPreview(file)}><FileText size={15}/><div><strong>{file.original_name}</strong><small>{Math.max(1, Math.round(file.size_bytes / 1024))} KB</small></div></button>)}{!files.length && <div className="management-empty compact">Files attached in project chats appear here.</div>}</section>
              </div>
            </div>
          ) : (
            <div className="management-placeholder"><Image src="/uvms-logo.png" width={68} height={68} alt="UVMS AI"/><h2>Choose a project</h2><p>Or create a new one to group conversations, files and project-specific context.</p><button className="primary-small" onClick={() => { setEditing(null); setName(''); setDescription(''); setInstructions(''); setCreating(true); }}><Plus size={15}/> Create project</button></div>
          )}
        </div>
      </section>
      {preview && <FilePreview file={preview} onClose={() => setPreview(null)}/>}
    </main>
  );
}
