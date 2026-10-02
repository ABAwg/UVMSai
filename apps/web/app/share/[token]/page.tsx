'use client';

import Image from 'next/image';
import { useParams } from 'next/navigation';
import { ArrowLeft, Bot, CalendarDays, FileText, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL, errorMessage, jsonOrThrow } from '@/lib/api';

type SharedMessage = {
  role: 'user' | 'assistant';
  content: string;
  model_id?: string | null;
  created_at?: string;
  attachments?: Array<{ original_name: string; mime_type: string; category: string; size_bytes: number }>;
};

type SharedChat = { title: string; created_at: string; messages: SharedMessage[] };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SharedConversationPage() {
  const params = useParams<{ token: string }>();
  const [chat, setChat] = useState<SharedChat | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const token = params?.token;
    if (!token) return;
    fetch(`${API_URL}/public/shares/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(response => jsonOrThrow<SharedChat>(response))
      .then(result => { if (alive) setChat(result); })
      .catch(err => { if (alive) setError(errorMessage(err)); });
    return () => { alive = false; };
  }, [params?.token]);

  return (
    <main className="public-share-page">
      <div className="background-grid"/>
      <header className="public-share-header">
        <a href="/" className="brand"><Image src="/uvms-logo.png" width={38} height={38} alt="UVMS"/><strong>UVMS <span>AI</span></strong></a>
        <div className="public-share-badge"><ShieldCheck size={14}/> Shared snapshot</div>
      </header>

      {error ? <section className="public-share-empty glass"><ShieldCheck size={38}/><h1>Shared conversation unavailable</h1><p>The link may have expired or been revoked.</p><a href="/"><ArrowLeft size={14}/> Open UVMS AI</a></section> : !chat ? <section className="public-share-empty glass"><div className="skeleton"/><p>Loading shared conversation…</p></section> : (
        <section className="public-share-shell">
          <div className="public-share-title">
            <div><small>UVMS AI · READ ONLY</small><h1>{chat.title}</h1></div>
            <span><CalendarDays size={14}/>{new Date(chat.created_at).toLocaleDateString()}</span>
          </div>
          <div className="public-share-thread">
            {chat.messages.map((message, index) => <article className={`public-share-message ${message.role}`} key={`${message.created_at || index}-${index}`}>
              <div className="message-avatar">{message.role === 'assistant' ? <Image src="/uvms-logo.png" width={27} height={27} alt="UVMS AI"/> : <UserRound size={18}/>}</div>
              <div className="message-body">
                <div className="message-meta">{message.role === 'assistant' ? <><Bot size={12}/> UVMS AI</> : 'You'}{message.model_id && <span>{message.model_id}</span>}</div>
                <div className="public-share-text">{message.content}</div>
                {!!message.attachments?.length && <div className="public-share-attachments">{message.attachments.map((file, fileIndex) => <div key={`${file.original_name}-${fileIndex}`}><FileText size={14}/><span>{file.original_name}</span><small>{formatBytes(file.size_bytes)}</small></div>)}</div>}
              </div>
            </article>)}
          </div>
          <footer className="public-share-footer"><ShieldCheck size={14}/> This is a static shared snapshot. Private files, account data and future chat edits are not exposed.</footer>
        </section>
      )}
    </main>
  );
}
