'use client';
import { useEffect, useState } from 'react';
import { readPreferences } from '@/lib/preferences';
import { errorMessage } from '@/lib/api';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Array<{ id: number; message: string; kind: string }>>([]);
  useEffect(() => {
    let sequence = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const notify = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const id = ++sequence;
      setItems(rows => [...rows.slice(-3), { id, message: errorMessage(detail.message), kind: detail.kind }]);
      timers.push(setTimeout(() => setItems(rows => rows.filter(item => item.id !== id)), 5000));
    };
    const expired = () => { if (location.pathname !== '/') location.assign('/'); };
    const appearance = () => {
      const preferences = readPreferences();
      document.documentElement.dataset.textSize = preferences.textSize;
      document.documentElement.dataset.motion = preferences.motion;
    };
    appearance();
    window.addEventListener('uvms-toast', notify);
    window.addEventListener('uvms-auth-expired', expired);
    window.addEventListener('uvms-preferences', appearance);
    return () => { timers.forEach(clearTimeout); window.removeEventListener('uvms-toast', notify); window.removeEventListener('uvms-auth-expired', expired); window.removeEventListener('uvms-preferences', appearance); };
  }, []);
  return <>{children}<div className="toast-stack" aria-live="polite">{items.map(item => <div key={item.id} className={`toast ${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'}><span>{item.message}</span><button aria-label="Dismiss notification" onClick={() => setItems(rows => rows.filter(row => row.id !== item.id))}>×</button></div>)}</div></>;
}
