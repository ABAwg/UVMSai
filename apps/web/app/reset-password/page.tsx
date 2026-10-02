'use client';

import Image from 'next/image';
import { KeyRound } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { apiFetch, ensureOk } from '@/lib/api';

export default function ResetPasswordPage() {
  return <Suspense fallback={<main className="boot-screen">Loading account recovery…</main>}><ResetPasswordForm/></Suspense>;
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const response = await apiFetch('/auth/password-reset/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, new_password: password }) });
      await ensureOk(response);
      setMessage('Password updated. You can sign in now.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Reset failed'); }
    finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-card glass"><div className="brand brand-large"><Image src="/uvms-logo.png" width={52} height={52} alt="UVMS"/><div><strong>UVMS <span>AI</span></strong><small>SECURE ACCOUNT RECOVERY</small></div></div><div className="reset-icon"><KeyRound size={24}/></div><h1>Set a new password</h1><p className="muted">This recovery link can only be used once.</p>{!token && <div className="error-box">Reset token is missing.</div>}{error && <div className="error-box">{error}</div>}{message ? <><div className="success-box">{message}</div><a className="primary-btn reset-link" href="/">Back to sign in</a></> : <form className="auth-form" onSubmit={submit}><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="New password (8+ chars)" minLength={8} required/><button className="primary-btn" disabled={busy || !token}>{busy ? 'Updating…' : 'Update password'}</button></form>}</section></main>;
}
