'use client';
import { useEffect, useState } from 'react';
import { errorMessage, readWebSession, restoreWebSession, WebSession } from './api';
import { toast } from './feedback';

export function useSession() {
  const [session, setSession] = useState<WebSession | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const current = readWebSession() || await restoreWebSession();
        if (!alive) return;
        if (!current) { location.assign('/'); return; }
        setSession(current);
      } catch (error) { toast(errorMessage(error), 'error'); }
    })();
    return () => { alive = false; };
  }, []);
  return [session, setSession] as const;
}
