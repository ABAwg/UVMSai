'use client';
import { useEffect, useRef, useState } from 'react';
import { apiFetch, ensureOk, errorMessage, FileAsset, downloadFile } from '@/lib/api';
import { toast } from '@/lib/feedback';

export function FilePreview({ file, onClose }: { file: FileAsset; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previewDialog = dialog.current;
    previewDialog?.showModal();
    let alive = true; let objectUrl = '';
    void (async () => {
      try {
        const response = await ensureOk(await apiFetch(`/files/${file.id}/download`));
        const blob = await response.blob();
        if (!alive) return;
        if (file.category === 'text') setText((await blob.text()).slice(0, 60000));
        else { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
      } catch (e) { if (alive) setError(errorMessage(e)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      previewDialog?.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [file.id, file.category]);
  return <dialog ref={dialog} className="preview-dialog" aria-label={`Preview ${file.original_name}`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="preview-header"><strong>{file.original_name}</strong><button onClick={onClose} aria-label="Close preview">×</button></div><div className="preview-body">{loading ? <div className="skeleton" role="status">Loading preview…</div> : error ? <p role="alert">{error}</p> : file.category === 'image' ? <img src={url} alt={file.original_name}/> : file.category === 'text' ? <pre>{text}</pre> : file.mime_type === 'application/pdf' ? <iframe src={url} title={file.original_name}/> : <p>Download this document to view it in your document or spreadsheet app.</p>}</div><button className="primary-small" onClick={() => downloadFile(file).catch(e => toast(errorMessage(e), 'error'))}>Download</button></dialog>;
}

export function PendingImage({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const value = URL.createObjectURL(file); setUrl(value); return () => URL.revokeObjectURL(value); }, [file]);
  return url ? <img className="pending-thumbnail" src={url} alt={file.name}/> : null;
}
