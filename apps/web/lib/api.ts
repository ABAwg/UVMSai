export const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

export type User = { id: string; email: string; display_name: string; role: string; created_at?: string };
export type Chat = {
  id: string;
  title: string;
  model_id: string;
  is_archived: boolean;
  is_pinned: boolean;
  is_temporary: boolean;
  expires_at?: string | null;
  created_at?: string;
  updated_at: string;
};
export type FileAsset = { id: string; original_name: string; mime_type: string; category: 'image' | 'document' | 'text'; size_bytes: number; created_at: string };
export type Citation = { type: 'url_citation'; url: string; title: string; start_index?: number; end_index?: number };
export type MessageMeta = {
  request_id?: string;
  stopped?: boolean;
  web_search?: boolean;
  web_search_status?: string;
  citations?: Citation[];
  image_generation?: boolean;
  image_prompt?: string;
  image_size?: string;
  image_quality?: string;
  demo?: boolean;
};
export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model_id?: string | null;
  created_at: string;
  attachments?: FileAsset[];
  meta?: MessageMeta;
};
export type ImageGenerateOut = { chat_id: string; message: Message; asset: FileAsset; demo: boolean };
export type TokenPair = { access_token: string; refresh_token?: string | null; token_type: string; user: User };
export type WebSession = { access: string; user: User };

const SESSION_KEY = 'uvms-session';
const LOGOUT_EVENT_KEY = 'uvms-session-logout';
let refreshPromise: Promise<WebSession | null> | null = null;
let sessionEpoch = 0;

export function errorMessage(value: unknown, status?: number): string {
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 429) return 'You have reached a usage or request limit. Please try again later or check your plan.';
  if (status === 504) return 'The response took too long. Try again.';
  if (status && status >= 500) return 'The service is temporarily unavailable. Please try again.';
  if (value instanceof Error) return errorMessage(value.message, status);
  if (typeof value === 'object' && value !== null) {
    const body = value as { message?: unknown; detail?: unknown; error?: { message?: unknown } };
    return errorMessage(body.error?.message || body.detail || body.message, status);
  }
  if (typeof value === 'string') {
    try { return errorMessage(JSON.parse(value), status); } catch {}
    if (/invalid or expired|refresh.*(revoked|expired)|authentication required/i.test(value)) return 'Your session has ended. Please sign in again.';
    if (/failed to fetch|network|load failed/i.test(value)) return 'Could not connect. Check your connection and try again.';
    if (/provider error|HTTP \d|traceback|^\s*[\[{]/i.test(value)) return 'The request could not be completed. Please try again.';
    if (value.length < 350) return value;
  }
  return status === 422 ? 'Please check the information you entered.' : 'Something went wrong. Please try again.';
}

export async function ensureOk(response: Response): Promise<Response> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(errorMessage(body, response.status));
  }
  return response;
}

export function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export function bearerHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function readWebSession(): WebSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value?.access && value?.user?.id ? value : null;
  } catch { return null; }
}

export function saveWebSession(pair: TokenPair): WebSession {
  const value = { access: pair.access_token, user: pair.user };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  return value;
}

export function clearWebSession() {
  sessionEpoch++;
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('uvms-active-project');
    window.dispatchEvent(new Event('uvms-auth-expired'));
  }
}

/** Notify other tabs after an explicit account-wide or current-session logout. */
export function broadcastWebLogout() {
  clearWebSession();
  if (typeof window !== 'undefined') {
    try { localStorage.setItem(LOGOUT_EVENT_KEY, `${Date.now()}-${Math.random()}`); } catch {}
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === LOGOUT_EVENT_KEY && event.newValue) clearWebSession();
  });
}

export async function restoreWebSession(): Promise<WebSession | null> {
  if (refreshPromise) return refreshPromise;
  const perform = async () => {
    const epoch = sessionEpoch;
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-UVMS-Client': 'web' },
        body: JSON.stringify({}),
      });
      if (response.status === 401 || response.status === 403) { clearWebSession(); return null; }
      await ensureOk(response);
      const pair = await response.json() as TokenPair;
      if (epoch !== sessionEpoch) return null;
      return saveWebSession(pair);
    } catch (error) {
      // Network failures must not destroy a valid cookie-backed session.
      throw new Error(errorMessage(error));
    }
  };
  // Cookies are shared between tabs. Serialize rotations across the origin too.
  refreshPromise = (async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request('uvms-session-refresh', perform);
    return await perform();
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function withAccess(init: RequestInit, access: string | undefined): RequestInit {
  const headers = new Headers(init.headers || {});
  if (access) headers.set('Authorization', `Bearer ${access}`);
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !isForm && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return { ...init, headers, credentials: init.credentials || 'include' };
}

/** Authenticated fetch with one cookie-backed access-token refresh retry on HTTP 401. */
export async function apiFetch(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
  const url = pathOrUrl.startsWith('http') || pathOrUrl.startsWith(API_URL + '/') ? pathOrUrl : `${API_URL}${pathOrUrl}`;
  const isAuth = /\/auth\//.test(url);
  if (url.endsWith('/auth/logout') && refreshPromise) await refreshPromise.catch(() => null);
  if (isAuth) init = { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), 'X-UVMS-Client': 'web' } };
  const session = readWebSession();
  let response = await fetch(url, withAccess(init, session?.access)).catch(error => { throw new Error(errorMessage(error)); });
  if (response.status !== 401 || isAuth) return response;
  // A slow 401 may arrive after another request already rotated the token.
  const latest = readWebSession();
  const refreshed = latest && latest.access !== session?.access ? latest : await restoreWebSession();
  if (!refreshed) return response;
  response = await fetch(url, withAccess(init, refreshed.access));
  if (response.status === 401) clearWebSession();
  return response;
}

export async function jsonOrThrow<T>(response: Response): Promise<T> {
  await ensureOk(response);
  return response.json() as Promise<T>;
}

export async function downloadFile(file: FileAsset) {
  const response = await ensureOk(await apiFetch(`/files/${file.id}/download`));
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = file.original_name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
