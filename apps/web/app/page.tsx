'use client';

import Image from 'next/image';
import ChartView from './chart';
import MathText from './math';
import { PendingImage } from './file-preview';
import { useVoice } from '@/lib/use-voice';
import { readPreferences, savePreferences } from '@/lib/preferences';
import { toast, copyText } from '@/lib/feedback';
import { ensureOk, errorMessage, downloadFile, broadcastWebLogout, readWebSession, saveWebSession } from '@/lib/api';
import { type ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowUp,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  FolderKanban,
  Globe2,
  ImageIcon,
  LogOut,
  Menu,
  MessageSquare,
  Mic,
  PanelLeftClose,
  Pin,
  PinOff,
  Pencil,
  Plus,
  Share2,
  GitBranch,
  Download,
  Clock3,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { API_URL, apiFetch, authHeaders, bearerHeaders, Chat, Citation, FileAsset, ImageGenerateOut, jsonOrThrow, Message, restoreWebSession, TokenPair, User } from '@/lib/api';
import { parseChart } from '@/lib/chart';
import { highlightedCode } from '@/lib/highlight';
import { inlineTokenPattern, readMathBlock, splitTableRow, tableColumnCount } from '@/lib/markdown';
import packageJson from '../package.json';

type AuthMode = 'login' | 'register';
type ActiveProject = { id: string; name: string };
type UsageSnapshot = {
  plan: string;
  plan_name: string;
  status: string;
  limits: Record<string, number>;
  today: { messages: number; web_searches: number };
  month: { images: number };
  storage_bytes: number;
};

type ModelOption = { id: string; label: string; hint: string; available: boolean; tier?: string };
const MODELS: ModelOption[] = [
  { id: 'uvms-1-fast', label: 'UVMS-1 Fast', hint: 'Quick answers', available: true, tier: 'free' },
  { id: 'uvms-1-balanced', label: 'UVMS-1 Balanced', hint: 'Best default', available: true, tier: 'free' },
  { id: 'uvms-1-deep', label: 'UVMS-1 Deep', hint: 'Hard problems', available: false, tier: 'plus' },
];

const STARTERS = [
  { icon: Globe2, title: 'Search the web', text: 'Fresh information with sources', disabled: false },
  { icon: FileText, title: 'Analyze files', text: 'PDF, docs and data', disabled: false },
  { icon: ImageIcon, title: 'Create images', text: 'Turn ideas into visuals', disabled: false },
  { icon: FolderKanban, title: 'Work on projects', text: 'Organize chats and files', disabled: false },
  { icon: Brain, title: 'Manage memory', text: 'Personalize your conversations', disabled: false },
  { icon: Clock3, title: 'Temporary chat', text: 'No history, Memory or Projects', disabled: false },
];

const STREAM_DEADLINE_MS = 140_000;
const CANCEL_TIMEOUT_MS = 3_000;
const HISTORY_TIMEOUT_MS = 5_000;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SecureImage({ file, token }: { file: FileAsset; token: string }) {
  const [src, setSrc] = useState<string>('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let objectUrl = '';
    let alive = true;
    setFailed(false);
    apiFetch(`${API_URL}/files/${file.id}/download`, { headers: bearerHeaders(token) })
      .then(async response => {
        if (!response.ok) throw new Error('Image unavailable');
        return response.blob();
      })
      .then(blob => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id, token, attempt]);
  if (failed) return <div className="secure-image-loading" role="alert">Image could not load.<button onClick={() => setAttempt(value => value + 1)}>Retry</button></div>;
  if (!src) return <div className="secure-image-loading"><ImageIcon size={22}/><span>Loading image…</span></div>;
  return <Image className="secure-generated-image" src={src} alt={file.original_name} width={1024} height={1024} unoptimized />;
}

function safeLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // React escapes source text; only KaTeX's untrusted renderer emits math markup.
  const token = inlineTokenPattern();
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = token.exec(text)) !== null) {
    if (match.index > cursor) out.push(text.slice(cursor, match.index));
    const value = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (value.startsWith('[')) {
      const parts = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(value);
      const href = parts ? safeLink(parts[2]) : null;
      out.push(href ? <a key={key} href={href} target="_blank" rel="noreferrer noopener">{parts![1]}</a> : value);
    } else if (value.startsWith('`')) {
      out.push(<code key={key}>{value.slice(1, -1)}</code>);
    } else if (value.startsWith('$')) {
      out.push(<MathText key={key} source={value.slice(1, -1)} fallbackSource={value} />);
    } else if (value.startsWith('\\(')) {
      out.push(<MathText key={key} source={value.slice(2, -2)} fallbackSource={value} />);
    } else if (value.startsWith('**')) {
      out.push(<strong key={key}>{value.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={key}>{value.slice(1, -1)}</em>);
    }
    cursor = match.index + value.length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  const tableAt = (index: number) => index + 1 < lines.length ? tableColumnCount(lines[index], lines[index + 1]) : 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    const math = readMathBlock(lines, i);
    if (math) { nodes.push(<MathText key={`math-${i}`} source={math.source} fallbackSource={math.raw} displayMode />); i = math.end + 1; continue; }

    const columns = tableAt(i);
    if (columns) {
      const start = i;
      const headers = splitTableRow(lines[i]);
      i += 2;
      const rows: ReactNode[] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|') && rows.length < 200) {
        const cells = splitTableRow(lines[i]);
        if (cells.length > columns) break;
        rows.push(<tr key={`tr-${i}`}>{Array.from({ length: columns }, (_, column) => <td key={column}>{renderInlineMarkdown(cells[column] || '', `td-${i}-${column}`)}</td>)}</tr>);
        i += 1;
      }
      nodes.push(<div key={`table-${start}`} className="markdown-table-scroll"><table><thead><tr>{headers.map((header, column) => <th key={column} scope="col">{renderInlineMarkdown(header, `th-${start}-${column}`)}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>);
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = renderInlineMarkdown(heading[2], `h-${i}`);
      nodes.push(level === 1 ? <h2 key={`h-${i}`}>{content}</h2> : level === 2 ? <h3 key={`h-${i}`}>{content}</h3> : <h4 key={`h-${i}`}>{content}</h4>);
      i += 1; continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      const start = i;
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(<li key={`ul-${i}`}>{renderInlineMarkdown(lines[i].replace(/^[-*]\s+/, ''), `ul-${i}`)}</li>); i += 1;
      }
      nodes.push(<ul key={`ul-${start}`}>{items}</ul>); continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      const start = i;
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(<li key={`ol-${i}`}>{renderInlineMarkdown(lines[i].replace(/^\d+\.\s+/, ''), `ol-${i}`)}</li>); i += 1;
      }
      nodes.push(<ol key={`ol-${start}`}>{items}</ol>); continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      const start = i;
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      nodes.push(<blockquote key={`q-${start}`}>{renderInlineMarkdown(quote.join(' '), `q-${start}`)}</blockquote>); continue;
    }

    const paragraph: string[] = [line];
    const start = i; i += 1;
    while (i < lines.length && lines[i].trim() && !tableAt(i) && !readMathBlock(lines, i) && !/^(#{1,3})\s+|^[-*]\s+|^\d+\.\s+|^>\s?/.test(lines[i])) { paragraph.push(lines[i]); i += 1; }
    nodes.push(<p key={`p-${start}`}>{renderInlineMarkdown(paragraph.join('\n'), `p-${start}`)}</p>);
  }
  return <>{nodes}</>;
}

const CodeBlock = memo(function CodeBlock({ language, code }: { language: string; code: string }) {
  const highlighted = useMemo(() => highlightedCode(code, language), [code, language]);
  return <div className="code-block">
    <div className="code-block-head"><span>{language || 'code'}</span><button type="button" onClick={() => copyText(code)}><Copy size={13}/> Copy</button></div>
    <pre>{highlighted === null ? <code>{code}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />}</pre>
  </div>;
});

function MessageContent({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = fence.exec(content)) !== null) {
    if (match.index > cursor) blocks.push(<MarkdownText key={`md-${index}`} text={content.slice(cursor, match.index)} />);
    const language = match[1].trim();
    const code = match[2].replace(/\n$/, '');
    const chart = language.toLowerCase() === 'chart' ? parseChart(code) : null;
    blocks.push(chart ? <ChartView key={`code-${index}`} chart={chart} /> : <CodeBlock key={`code-${index}`} language={language} code={code} />);
    cursor = match.index + match[0].length; index += 1;
  }
  if (cursor < content.length) blocks.push(<MarkdownText key={`md-${index}`} text={content.slice(cursor)} />);
  return <div className="markdown-content">{blocks}</div>;
}

function loadSession(): { access: string; user: User } | null {
  return readWebSession();
}

function saveSession(pair: TokenPair) {
  return saveWebSession(pair);
}

function AuthScreen({ onAuth }: { onAuth: (session: ReturnType<typeof saveSession>) => void }) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const [resetAvailable, setResetAvailable] = useState(false);
  useEffect(() => { apiFetch('/auth/options').then(r => r.ok ? r.json() : null).then(value => setResetAvailable(value?.password_reset === true)).catch(() => {}); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const body = mode === 'register' ? { email, password, display_name: name || 'UVMS User' } : { email, password };
      const res = await apiFetch(`${API_URL}/auth/${mode}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const pair = await jsonOrThrow<TokenPair>(res);
      onAuth(saveSession(pair));
    } catch (e) { setError(e instanceof Error ? e.message : 'Authentication failed'); }
    finally { setLoading(false); }
  }

  async function requestReset() {
    setError(''); setResetMessage('');
    if (!email.trim()) { setError('Enter your email first.'); return; }
    try {
      const response = await apiFetch(`${API_URL}/auth/password-reset/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || 'Could not request reset');
      setResetMessage(body.message || 'If the account exists, reset instructions were sent.');
      if (body.debug_reset_url) window.location.href = body.debug_reset_url;
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not request reset'); }
  }

  return (
    <main className="auth-page">
      <div className="auth-orb auth-orb-a" /><div className="auth-orb auth-orb-b" />
      <section className="auth-card glass">
        <div className="brand brand-large">
          <Image src="/uvms-logo.png" width={52} height={52} alt="UVMS" priority />
          <div><strong>UVMS <span>AI</span></strong><small>THINK · CREATE · DO TOGETHER</small></div>
        </div>
        <div className="beta-badge">PUBLIC BETA</div>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your UVMS AI account'}</h1>
        <p className="muted">One account. Same chats on web and mobile.</p>
        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && <input aria-label="Your name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required />}
          <input aria-label="Email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" required />
          <input aria-label="Password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (8+ chars)" type="password" required minLength={8} />
          {error && <div className="error-box">{error}</div>}
          {resetMessage && <div className="success-box">{resetMessage}</div>}
          <button className="primary-btn" disabled={loading}>{loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        {mode === 'login' && resetAvailable && <button className="link-btn" onClick={requestReset}>Forgot password?</button>}
        <button className="link-btn" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'New to UVMS AI? Create account' : 'Already have an account? Sign in'}
        </button>
      </section>
    </main>
  );
}

export default function Home() {
  const [session, setSession] = useState<ReturnType<typeof loadSession>>(null);
  const [booted, setBooted] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatCount, setChatCount] = useState(0);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [activeChatInfo, setActiveChatInfo] = useState<Chat | null>(null);
  const [temporaryMode, setTemporaryMode] = useState(false);
  const [shareDialog, setShareDialog] = useState<{ id: string; url: string; title: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('uvms-1-balanced');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>(MODELS);
  const [sending, setSending] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [modelMenu, setModelMenu] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingMessage, setEditingMessage] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [imageSize, setImageSize] = useState('1024x1024');
  const voice = useVoice(text => setInput(current => `${current}${current.trim() ? ' ' : ''}${text}`), setError);
  const { listening } = voice;
  const [uploadProgress, setUploadProgress] = useState('');
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null);
  const [chatMenu, setChatMenu] = useState<string | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const followBottom = useRef(true);
  const viewVersion = useRef(0);
  const chatListVersion = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const uploadedFiles = useRef(new WeakMap<File, FileAsset>());
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'reading' | 'completed' | 'demo' | 'failed'>('idle');
  const [activeProject, setActiveProject] = useState<ActiveProject | null>(null);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [aiMode, setAiMode] = useState('');
  const [providerName, setProviderName] = useState('');
  const [toolsAvailable,setToolsAvailable] = useState({search:false,images:false,voice:false,vision:false});
  const [billingAvailable, setBillingAvailable] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendLockRef = useRef<symbol | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    let alive = true;
    const expired = () => { viewVersion.current++; chatListVersion.current++; abortRef.current?.abort(); voice.cancel(); setActiveProject(null); setSession(null); setChats([]); setMessages([]); setActiveChat(null); setActiveChatInfo(null); setTemporaryMode(false); };
    window.addEventListener('uvms-auth-expired', expired);

    void (async () => {
      try {
        const rawProject = localStorage.getItem('uvms-active-project');
        if (rawProject) setActiveProject(JSON.parse(rawProject));
      } catch { localStorage.removeItem('uvms-active-project'); }

      setSidebar(window.innerWidth > 900);
      const prefs = readPreferences(); setModel(prefs.model); setWebSearch(prefs.search);
      const cached = loadSession();
      if (cached) {
        if (alive) setSession(cached);
      } else {
        // The refresh token lives only in an HttpOnly cookie. Recover an access token
        // after reload/new tab without exposing the refresh credential to JavaScript.
        const restored = await restoreWebSession().catch(e => { setError(errorMessage(e)); return null; });
        if (alive && restored) setSession(restored);
      }
      if (alive) setBooted(true);
    })();

    return () => { alive = false; window.removeEventListener('uvms-auth-expired', expired); };
  }, []);

  const access = session?.access || '';
  const currentModel = useMemo(() => modelOptions.find(x => x.id === model) || modelOptions.find(x => x.available) || MODELS[1], [model, modelOptions]);
  const filteredChats = chats;
  const pinnedChats = useMemo(() => showArchived ? [] : filteredChats.filter(chat => chat.is_pinned), [filteredChats, showArchived]);
  const regularChats = useMemo(() => showArchived ? filteredChats : filteredChats.filter(chat => !chat.is_pinned), [filteredChats, showArchived]);
  const planName = usage?.plan_name || (session?.user.role === 'admin' ? 'Admin' : 'Free');
  const messageLimit = Number(usage?.limits?.messages_daily || 0);
  const messagesToday = Number(usage?.today?.messages || 0);
  const usagePercent = messageLimit > 0 ? Math.min(100, Math.round((messagesToday / messageLimit) * 100)) : 0;
  const runtimeLabel = uploadingFiles ? 'Uploading files…' : listening ? `Recording ${Math.floor(voice.seconds/60)}:${String(voice.seconds%60).padStart(2,'0')}` : sending ? (imageMode ? 'Creating image…' : webSearch ? (searchStatus === 'searching' ? 'Searching the web…' : searchStatus === 'completed' ? 'Answer complete' : 'Reading sources…') : 'Thinking…') : '';

  const fetchChats = useCallback(async (offset = 0) => {
    if (!access) return;
    const version = ++chatListVersion.current;
    setLoadingChats(true);
    try {
      const response = await apiFetch(`/chats?archived=${showArchived}&q=${encodeURIComponent(search)}&offset=${offset}`);
      const rows = await jsonOrThrow<Chat[]>(response);
      if (version === chatListVersion.current) { setChats(current => offset ? [...current, ...rows] : rows); setChatCount(Number(response.headers.get('X-Total-Count') || rows.length)); }
    } catch (e) { if (version === chatListVersion.current) setError(errorMessage(e)); } finally { if (version === chatListVersion.current) setLoadingChats(false); }
  }, [access, showArchived, search]);

  useEffect(() => { const timer = setTimeout(() => void fetchChats(), search ? 180 : 0); return () => { clearTimeout(timer); chatListVersion.current++; }; }, [fetchChats, search]);
  useEffect(() => {
    if (!access) return;
    let alive=true;
    const refresh=()=>apiFetch('/capabilities').then(r=>jsonOrThrow<{ai_mode:string;provider:string;search:boolean;images:boolean;voice:boolean;vision?:boolean;billing_enabled?:boolean}>(r)).then(result=>{if(!alive)return;setAiMode(result.ai_mode);setProviderName(result.provider);setToolsAvailable({...result,vision:result.vision ?? true});setBillingAvailable(result.billing_enabled === true);if(!result.search)setWebSearch(false);if(!result.images)setImageMode(false);}).catch(e=>{if(alive)setError(errorMessage(e));});
    void refresh(); const timer=setInterval(()=>void refresh(),30000);window.addEventListener('focus',refresh);
    return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',refresh);};
  }, [access]);
  useEffect(() => {
    if (!access) return;
    apiFetch(`${API_URL}/models`, { headers: authHeaders(access) })
      .then(response => jsonOrThrow<Array<{ id: string; name: string; description: string; tier: string; available: boolean }>>(response))
      .then(rows => {
        const mapped = rows.map(row => ({ id: row.id, label: row.name, hint: row.description, available: row.available, tier: row.tier }));
        if (mapped.length) {
          setModelOptions(mapped);
          if (!mapped.some(item => item.id === model && item.available)) {
            const fallback = mapped.find(item => item.available);
            if (fallback) setModel(fallback.id);
          }
        }
      })
      .catch(() => {});
  }, [access, model]);
  useEffect(() => {
    if (!access) { setUsage(null); return; }
    apiFetch(`${API_URL}/usage/me`, { headers: authHeaders(access) })
      .then(response => jsonOrThrow<UsageSnapshot>(response))
      .then(setUsage)
      .catch(() => {});
  }, [access, chats.length, messages.length]);
  useEffect(() => {
    if (!access || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const chatFromUrl = params.get('chat');
    if (chatFromUrl) openChat(chatFromUrl, 'none').catch(err => setError(err instanceof Error ? err.message : 'Failed to open chat'));
  }, [access]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!access) return;
    const restoreHistory = () => {
      const id = new URLSearchParams(window.location.search).get('chat');
      if (id) void openChat(id, 'none');
      else newChat('none');
    };
    window.addEventListener('popstate', restoreHistory);
    return () => window.removeEventListener('popstate', restoreHistory);
  }, [access]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!messages.length) conversationRef.current?.scrollTo({ top: 0 });
    else if (followBottom.current) bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages, sending]);
  useEffect(() => { if (composerRef.current) { composerRef.current.style.height = 'auto'; composerRef.current.style.height = Math.min(composerRef.current.scrollHeight, 190) + 'px'; } }, [input]);
  useEffect(() => { const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { setModelMenu(false); setChatMenu(null); setShareDialog(null); setSidebar(window.innerWidth > 900); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); newChat(); }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 't') { event.preventDefault(); startTemporaryChat(); }
  }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);

  function navigateChat(id: string | null, navigation: 'push' | 'none') {
    if (navigation === 'none') return;
    const url = id ? `/?chat=${encodeURIComponent(id)}` : '/';
    if (`${window.location.pathname}${window.location.search}` !== url) window.history.pushState(null, '', url);
  }

  async function openChat(id: string, navigation: 'push' | 'none' = 'push') {
    if (!access) return;
    const version = ++viewVersion.current;
    sendLockRef.current = null;
    setLoadingChat(true); setError(''); setEditingMessage(null); setRetry(null);
    if (abortRef.current) await stopGeneration();
    if (version !== viewVersion.current) return;
    try {
      const chat = await jsonOrThrow<Chat & { messages: Message[]; project?: ActiveProject | null }>(await apiFetch(`/chats/${id}`));
      if (version !== viewVersion.current) return;
      setActiveChat(id); setActiveChatInfo(chat); setTemporaryMode(chat.is_temporary); setSending(false); setMessages(chat.messages); setModel(chat.model_id); followBottom.current = true;
      if (chat.project) { setActiveProject(chat.project); localStorage.setItem('uvms-active-project', JSON.stringify(chat.project)); }
      else { localStorage.removeItem('uvms-active-project'); setActiveProject(null); }
      navigateChat(id, navigation);
      if (window.innerWidth <= 900) setSidebar(false);
    } catch (e) { if (version === viewVersion.current) { setError(errorMessage(e)); setRetry(() => () => openChat(id, navigation)); } }
    finally { if (version === viewVersion.current) { setLoadingChat(false); setSending(false); } }
  }

  function newChat(navigation: 'push' | 'none' = 'push') {
    viewVersion.current++;
    sendLockRef.current = null;
    void stopGeneration();
    voice.cancel();
    setSending(false); setLoadingChat(false); setActiveChat(null); setActiveChatInfo(null); setTemporaryMode(false); setMessages([]); setInput(''); setPendingFiles([]); setError(''); setRetry(null); setEditingMessage(null); setSearchStatus('idle');
    followBottom.current = true; navigateChat(null, navigation);
    if (window.innerWidth <= 900) setSidebar(false);
  }

  function startTemporaryChat() {
    newChat();
    setTemporaryMode(true);
    setActiveProject(null);
    localStorage.removeItem('uvms-active-project');
    toast('Temporary chat started. It will not appear in history or use Memory.', 'info');
  }

  function clearActiveProject() {
    localStorage.removeItem('uvms-active-project');
    setActiveProject(null);
    if (activeChat) newChat();
  }

  async function patchChat(id: string, patch: Partial<Pick<Chat, 'title' | 'is_archived' | 'is_pinned' | 'model_id'>>) {
    if (!access) return;
    await jsonOrThrow<Chat>(await apiFetch(`${API_URL}/chats/${id}`, {
      method: 'PATCH', headers: authHeaders(access), body: JSON.stringify(patch),
    }));
    await fetchChats();
  }

  async function pinChat(chat: Chat, e: React.MouseEvent) {
    e.stopPropagation(); setChatMenu(null);
    try { await patchChat(chat.id, { is_pinned: !chat.is_pinned }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Pin action failed'); }
  }

  async function shareActiveChat() {
    if (!activeChat || !access || activeChatInfo?.is_temporary || sharing) return;
    setSharing(true); setError('');
    try {
      const result = await jsonOrThrow<{ id: string; url_token: string; title: string }>(await apiFetch(`/chats/${activeChat}/share`, { method: 'POST' }));
      const url = `${window.location.origin}/share/${encodeURIComponent(result.url_token)}`;
      setShareDialog({ id: result.id, url, title: result.title });
      await copyText(url);
      toast('Share link created and copied.', 'success');
    } catch (err) { setError(errorMessage(err)); }
    finally { setSharing(false); }
  }

  async function revokeShare() {
    if (!shareDialog) return;
    try {
      await ensureOk(await apiFetch(`/shares/${shareDialog.id}`, { method: 'DELETE' }));
      setShareDialog(null);
      toast('Share link revoked.', 'success');
    } catch (err) { setError(errorMessage(err)); }
  }

  async function forkConversation(message?: Message) {
    if (!activeChat || !access || sending) return;
    try {
      const result = await jsonOrThrow<Chat & { messages: Message[] }>(await apiFetch(`/chats/${activeChat}/fork`, {
        method: 'POST',
        body: JSON.stringify({ through_message_id: message?.id || null }),
      }));
      await fetchChats();
      await openChat(result.id);
      toast(message ? 'Branched from this message.' : 'Conversation duplicated as a new branch.', 'success');
    } catch (err) { setError(errorMessage(err)); }
  }

  async function exportActiveChat() {
    if (!activeChat) return;
    try {
      const response = await ensureOk(await apiFetch(`/chats/${activeChat}/export?format=markdown`));
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${(activeChatInfo?.title || 'uvms-chat').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60)}.md`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Conversation exported.', 'success');
    } catch (err) { setError(errorMessage(err)); }
  }

  async function renameChat(chat: Chat, e: React.MouseEvent) {
    e.stopPropagation(); setChatMenu(null);
    const title = window.prompt('Rename chat', chat.title)?.trim();
    if (!title || title === chat.title) return;
    try { await patchChat(chat.id, { title }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Rename failed'); }
  }

  async function archiveChat(chat: Chat, e: React.MouseEvent) {
    e.stopPropagation(); setChatMenu(null);
    try {
      await patchChat(chat.id, { is_archived: !chat.is_archived });
      if (activeChat === chat.id) newChat();
    } catch (err) { setError(err instanceof Error ? err.message : 'Archive failed'); }
  }

  async function removeChat(id: string, e: React.MouseEvent) {
    e.stopPropagation(); setChatMenu(null);
    if (!access || !window.confirm('Delete this chat permanently?')) return;
    try {
      await ensureOk(await apiFetch(`${API_URL}/chats/${id}`, { method: 'DELETE', headers: authHeaders(access) }));
      if (activeChat === id) newChat();
      await fetchChats();
    } catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  function chooseFiles(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    if (!toolsAvailable.vision && incoming.some(file => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name))) {
      setError('Vision is temporarily unavailable (Beta). You can still attach documents.'); return;
    }
    const unsupported = incoming.find(file => !/\.(png|jpe?g|webp|gif|pdf|docx|xlsx|txt|md|csv|json|py|js|jsx|ts|tsx|html|css|sql|yaml|yml|xml|log)$/i.test(file.name));
    if (unsupported) { setError(`${unsupported.name}: unsupported file type.`); return; }
    if (incoming.length + pendingFiles.length > 8) { setError('Attach up to 8 files per message.'); return; }
    const tooLarge = incoming.find(file => file.size > 20 * 1024 * 1024);
    if (tooLarge) { setError(`${tooLarge.name} exceeds the 20 MB limit`); return; }
    setPendingFiles(current => [...current, ...incoming].slice(0, 8));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removePendingFile(index: number) {
    setPendingFiles(current => current.filter((_, i) => i !== index));
  }

  async function uploadFiles(files: File[], signal: AbortSignal) {
    const uploaded: FileAsset[] = [];
    setUploadingFiles(true);
    try {
      for (const [index, file] of files.entries()) {
        if (signal.aborted) throw new DOMException('Upload stopped', 'AbortError');
        const cached = uploadedFiles.current.get(file);
        if (cached) { uploaded.push(cached); continue; }
        setUploadProgress(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
        const form = new FormData();
        form.append('upload', file);
        if (activeProject) form.append('project_id', activeProject.id);
        const asset = await jsonOrThrow<FileAsset>(await apiFetch(`${API_URL}/files`, {
          method: 'POST', headers: bearerHeaders(access), body: form, signal,
        }));
        uploadedFiles.current.set(file, asset);
        uploaded.push(asset);
      }
      return uploaded;
    } finally { setUploadingFiles(false); setUploadProgress(''); }
  }

  function stopGeneration() {
    const requestId = requestIdRef.current;
    const controller = abortRef.current;
    controller?.abort();
    if (abortRef.current === controller) { abortRef.current = null; requestIdRef.current = null; }
    if (requestId && access) {
      void apiFetch(`${API_URL}/chat/cancel/${requestId}`, {
        method: 'POST', headers: bearerHeaders(access), signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
      }).catch(() => {});
    }
  }

  async function generateImage(text = input) {
    const prompt = text.trim();
    if (!prompt || !access || sending || sendLockRef.current) return;
    if (pendingFiles.length) { setError('Image generation mode does not use file attachments yet. Remove them or switch back to Chat.'); return; }
    const version = viewVersion.current;
    const lock = Symbol('image'); sendLockRef.current = lock;
    setSending(true); setError(''); setInput('');
    try {
      const result = await jsonOrThrow<ImageGenerateOut>(await apiFetch(`${API_URL}/images/generate`, {
        method: 'POST',
        headers: authHeaders(access),
        body: JSON.stringify({ chat_id: activeChat, prompt, project_id: temporaryMode ? null : activeProject?.id || null, temporary: temporaryMode, size: imageSize, quality: 'medium' }),
      }));
      if (version !== viewVersion.current) { void fetchChats(); return; }
      setActiveChat(result.chat_id);
      await fetchChats();
      await openChat(result.chat_id);
    } catch (e) { if (version === viewVersion.current) { setInput(prompt); setError(errorMessage(e)); setRetry(() => () => generateImage(prompt)); } }
    finally { if (sendLockRef.current === lock) sendLockRef.current = null; if (version === viewVersion.current) setSending(false); }
  }

  async function send(text = input, retryTarget?: { chatId: string; messageId: string }) {
    if (imageMode && !retryTarget) { await generateImage(text); return; }
    const content = text.trim();
    const files = [...pendingFiles];
    if ((!content && !files.length && !retryTarget) || !access || sending || sendLockRef.current) return;
    const version = viewVersion.current;
    const lock = Symbol('stream'); sendLockRef.current = lock;
    const previous = messages;
    const controller = new AbortController(); abortRef.current = controller;
    let acceptedChat = retryTarget?.chatId || activeChat;
    let acceptedMessage = retryTarget?.messageId || '';
    let acceptedRequestId: string | null = null;
    let accepted = false;
    let answer = '';
    let completed = false;
    let deadlineReached = false;
    let deadline: number | null = null;
    const tempAssistant: Message = { id: `a-${Date.now()}`, role: 'assistant', content: '', model_id: model, created_at: new Date().toISOString(), meta: { web_search: webSearch, citations: [] } };
    setError(''); setRetry(null); setSending(true); setEditingMessage(null); setSearchStatus(webSearch ? 'searching' : 'idle'); followBottom.current = true;
    try {
      const uploaded = !retryTarget && files.length ? await uploadFiles(files, controller.signal) : [];
      if (controller.signal.aborted || version !== viewVersion.current) return;
      const tempUser: Message = { id: `u-${Date.now()}`, role: 'user', content, attachments: uploaded, created_at: new Date().toISOString() };
      setMessages(prev => [...prev, ...(retryTarget ? [] : [tempUser]), tempAssistant]);
      deadline = window.setTimeout(() => {
        if (abortRef.current === controller && !controller.signal.aborted) {
          deadlineReached = true;
          stopGeneration();
        }
      }, STREAM_DEADLINE_MS);
      const res = await apiFetch('/chat/stream', {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ chat_id: acceptedChat, retry_message_id: retryTarget?.messageId, content, model_id: model, attachment_ids: uploaded.map(file => file.id), web_search: webSearch, project_id: temporaryMode ? null : activeProject?.id || null, temporary: temporaryMode }),
      });
      await ensureOk(res);
      if (version !== viewVersion.current || controller.signal.aborted) { controller.abort(); return; }
      if (!res.body) throw new Error('No response received. Please try again.');
      accepted = true;
      acceptedChat = res.headers.get('X-UVMS-Chat-Id') || acceptedChat;
      acceptedMessage = res.headers.get('X-UVMS-Message-Id') || acceptedMessage;
      acceptedRequestId = res.headers.get('X-UVMS-Request-Id');
      requestIdRef.current = acceptedRequestId;
      setInput(''); setPendingFiles([]);
      if (acceptedChat) { setActiveChat(acceptedChat); navigateChat(acceptedChat, 'push'); }
      setShowArchived(false); setSearch(''); void fetchChats();
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        buffer = (buffer + decoder.decode(value || new Uint8Array(), { stream: !done })).replace(/\r\n/g, '\n');
        const frames = buffer.split('\n\n'); buffer = frames.pop() || '';
        for (const frame of frames) {
          const event = frame.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim();
          const dataLine = frame.split('\n').find(line => line.startsWith('data:'))?.slice(5).trim();
          if (!dataLine) continue;
          const data = JSON.parse(dataLine);
          if (event === 'delta' && data.delta) {
            answer += data.delta;
            if (version === viewVersion.current) setMessages(prev => prev.map(m => m.id === tempAssistant.id ? { ...m, content: answer } : m));
          } else if (event === 'tool' && data.tool === 'web_search') { setSearchStatus(data.status); if(data.status==='failed')setMessages(prev=>prev.map(m=>m.id===tempAssistant.id?{...m,meta:{...m.meta,citations:[]}}:m)); }
          else if (event === 'citation' && data.citation && safeLink(data.citation.url)) {
            setMessages(prev => prev.map(m => m.id === tempAssistant.id ? { ...m, meta: { ...m.meta, citations: [...(m.meta?.citations || []), data.citation] } } : m));
          } else if (event === 'done') completed = true;
          else if (event === 'error') throw new Error(data.message || 'Generation failed');
        }
        if (done) break;
      }
      if (!completed) throw new Error('The connection was interrupted. Please retry your message.');
      if (deadline) { clearTimeout(deadline); deadline = null; }
      if (acceptedChat && version === viewVersion.current) {
        const chat = await jsonOrThrow<Chat & { messages: Message[] }>(await apiFetch(`/chats/${acceptedChat}`, { signal: AbortSignal.timeout(HISTORY_TIMEOUT_MS) }));
        if (version === viewVersion.current) { setMessages(chat.messages); setActiveChatInfo(chat); setTemporaryMode(chat.is_temporary); }
      }
      void fetchChats();
    } catch (e) {
      if (deadline) { clearTimeout(deadline); deadline = null; }
      if (version !== viewVersion.current) return;
      const stopped = controller.signal.aborted && !deadlineReached;
      let reconciled = false;
      if (accepted && acceptedChat) {
        try {
          const chat = await jsonOrThrow<Chat & { messages: Message[] }>(await apiFetch(`/chats/${acceptedChat}`, { signal: AbortSignal.timeout(HISTORY_TIMEOUT_MS) }));
          if (version === viewVersion.current) {
            const persisted = acceptedRequestId && chat.messages.some(message => message.meta?.request_id === acceptedRequestId);
            const partial = (stopped || deadlineReached) && answer.trim() && !persisted
              ? { ...tempAssistant, content: answer, meta: { ...tempAssistant.meta, stopped: true } }
              : null;
            setMessages(partial ? [...chat.messages, partial] : chat.messages);
            setActiveChatInfo(chat); setTemporaryMode(chat.is_temporary);
            reconciled = true;
          }
        } catch {
          setMessages(prev => (stopped || deadlineReached || completed) && answer.trim()
            ? prev.map(message => message.id === tempAssistant.id ? { ...message, content: answer, meta: { ...message.meta, stopped: !completed } } : message)
            : prev.filter(message => message.id !== tempAssistant.id));
        }
      } else { setMessages(previous); setInput(content); }
      if (version !== viewVersion.current) return;
      if (stopped) toast('Generation stopped.', 'info');
      else if (completed) {
        if (!reconciled && acceptedChat) { const chatId = acceptedChat; setError('The answer is complete, but history could not refresh. Reopen the chat to sync it.'); setRetry(() => () => openChat(chatId, 'none')); }
      } else {
        setError(deadlineReached ? 'The response took too long. Please retry your message.' : errorMessage(e));
        const target = acceptedChat && acceptedMessage ? { chatId: acceptedChat, messageId: acceptedMessage } : undefined;
        setRetry(() => () => send(content, target));
      }
      void fetchChats();
    } finally {
      if (deadline) clearTimeout(deadline);
      if (abortRef.current === controller) { abortRef.current = null; requestIdRef.current = null; }
      if (sendLockRef.current === lock) sendLockRef.current = null;
      if (version === viewVersion.current) { setSending(false); setSearchStatus('idle'); }
    }
  }

  function beginEdit(message: Message) {
    setEditingMessage(message.id);
    setEditValue(message.content);
  }

  async function saveEdit(message: Message) {
    const content = editValue.trim();
    if (!activeChat || !access || !content || sending) return;
    const version = viewVersion.current;
    setSending(true); setError('');
    try {
      await jsonOrThrow(await apiFetch(`${API_URL}/chats/${activeChat}/messages/${message.id}/edit`, {
        method: 'POST', headers: authHeaders(access), body: JSON.stringify({ content, model_id: model }),
      }));
      if (version !== viewVersion.current) { void fetchChats(); return; }
      setEditingMessage(null);
      await openChat(activeChat, 'none');
      await fetchChats();
    } catch (e) { if (version === viewVersion.current) { setError(errorMessage(e)); setRetry(() => () => saveEdit(message)); } }
    finally { if (version === viewVersion.current) setSending(false); }
  }

  async function regenerate(message: Message) {
    if (!activeChat || !access || sending) return;
    const version = viewVersion.current;
    setSending(true); setError('');
    try {
      await jsonOrThrow(await apiFetch(`${API_URL}/chats/${activeChat}/messages/${message.id}/regenerate`, {
        method: 'POST', headers: authHeaders(access), body: JSON.stringify({ model_id: model }),
      }));
      if (version !== viewVersion.current) { void fetchChats(); return; }
      await openChat(activeChat, 'none');
      await fetchChats();
    } catch (e) { if (version === viewVersion.current) { setError(errorMessage(e)); setRetry(() => () => regenerate(message)); } }
    finally { if (version === viewVersion.current) setSending(false); }
  }

  async function copyMessage(message: Message) {
    await copyText(message.content);
    setCopiedMessage(message.id);
    window.setTimeout(() => setCopiedMessage(null), 1200);
  }

  async function logout() {
    abortRef.current?.abort();
    try {
      await ensureOk(await apiFetch(`${API_URL}/auth/logout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      }));
    } catch (e) { setError(errorMessage(e)); setRetry(() => logout); return; }
    broadcastWebLogout(); setSession(null); setChats([]); setMessages([]); setActiveChat(null);
  }

  function renderChatRow(chat: Chat) {
    return <div key={chat.id} className={`chat-row ${activeChat === chat.id ? 'active' : ''}`} role="button" tabIndex={0} onKeyDown={e => { if (e.target === e.currentTarget && e.key === 'Enter') void openChat(chat.id); }} onClick={() => openChat(chat.id)}>
      {chat.is_pinned ? <Pin size={14} className="pinned-chat-icon"/> : <MessageSquare size={15}/>}<span className="chat-title">{chat.title}</span>
      <button className="chat-menu-trigger" title={`Actions for ${chat.title}`} aria-expanded={chatMenu === chat.id} onClick={e => { e.stopPropagation(); setChatMenu(chatMenu === chat.id ? null : chat.id); }}>•••</button>
      {chatMenu === chat.id && <span className="chat-actions context-menu" role="menu" onClick={() => setChatMenu(null)}>
        {!chat.is_archived && <button title={chat.is_pinned ? 'Unpin' : 'Pin'} onClick={(e) => pinChat(chat, e)}>{chat.is_pinned ? <PinOff size={13}/> : <Pin size={13}/>} {chat.is_pinned ? 'Unpin' : 'Pin'}</button>}
        <button title="Rename" onClick={(e) => renameChat(chat, e)}><Pencil size={13}/> Rename</button>
        <button title={chat.is_archived ? 'Restore' : 'Archive'} onClick={(e) => archiveChat(chat, e)}><Archive size={13}/> {chat.is_archived ? 'Restore' : 'Archive'}</button>
        <button title="Delete" onClick={(e) => removeChat(chat.id, e)}><Trash2 size={13}/> Delete</button>
      </span>}
    </div>;
  }

  if (!booted) return <main className="boot-screen" role="status"><div className="skeleton"/>Loading your workspace…</main>;
  if (!session) return <AuthScreen onAuth={setSession} />;

  return (
    <main className={`app-shell ${sidebar ? 'sidebar-visible' : 'sidebar-hidden'}`}>
      <div className="background-grid" />
      <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
        <div className="side-top">
          <div className="brand"><Image src="/uvms-logo.png" width={36} height={36} alt="UVMS" priority /><strong>UVMS <span>AI</span></strong><b>BETA</b></div>
          <button title="Close sidebar" className="icon-btn desktop-only" onClick={() => setSidebar(false)}><PanelLeftClose size={18}/></button>
          <button title="Close sidebar" className="icon-btn mobile-only" onClick={() => setSidebar(false)}><X size={20}/></button>
        </div>
        <button className="new-chat" onClick={() => newChat()}><Plus size={18}/> New chat <kbd>⌘ K</kbd></button>
        <div className="chat-search"><Search size={15}/><input aria-label="Search chats" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chats" /></div>
        <nav className="main-nav">
          <button onClick={() => setShowArchived(value => !value)} className={showArchived ? 'nav-active' : ''}><Archive size={17}/> {showArchived ? 'Back to chats' : 'Archived chats'} <span>{showArchived ? 'LIVE' : 'OPEN'}</span></button>
          <a href="/projects"><FolderKanban size={17}/> Projects <span>LIVE</span></a>
          <a href="/memory"><Brain size={17}/> Memory <span>LIVE</span></a>
          <a href="/library"><FileText size={17}/> Library <span>LIVE</span></a>
          <a href="/shares"><Share2 size={17}/> Shared links <span>LIVE</span></a>
        </nav>
        <div className="chat-list">
          {!showArchived && pinnedChats.length > 0 && <><div className="side-section-title compact"><span>Pinned</span><small>{pinnedChats.length}</small></div>{pinnedChats.map(renderChatRow)}</>}
          <div className="side-section-title compact"><span>{showArchived ? 'Archived' : 'Recent chats'}</span><small>{showArchived ? chatCount : regularChats.length}</small></div>
          {regularChats.map(renderChatRow)}
          {chats.length < chatCount && <button className="secondary-small" disabled={loadingChats} onClick={() => fetchChats(chats.length)}>Load older chats</button>}
          {loadingChats && <div className="skeleton" role="status">Loading chats…</div>}{!loadingChats && !filteredChats.length && <p className="empty-sidebar">{search ? 'No matching chats.' : showArchived ? 'No archived chats.' : 'Your conversations will appear here.'}</p>}
        </div>
        <a className="upgrade-card" href="/billing">
          <div className="upgrade-head"><Sparkles size={17}/><strong>{!billingAvailable ? 'Public Beta' : usage?.plan === 'free' || !usage ? 'Upgrade your plan' : `${planName} plan`}</strong><b>›</b></div>
          <p>{!billingAvailable ? 'Paid plans are coming soon. View your daily usage.' : usage?.plan === 'free' || !usage ? 'Unlock Deep, larger limits and more creative tools.' : 'Manage your subscription and usage limits.'}</p>
          {messageLimit > 0 && <div className="usage-meter"><div><span>Messages today</span><em>{messagesToday} / {messageLimit}</em></div><i><b style={{ width: `${usagePercent}%` }} /></i></div>}
        </a>
        <div className="user-card"><div className="avatar">{session.user.display_name.slice(0, 1).toUpperCase()}</div><div><strong>{session.user.display_name}</strong><small>{session.user.role === 'admin' ? 'Admin workspace' : `${planName} plan`}</small></div><a className="icon-btn" href="/settings" title="Account settings"><Settings size={16}/></a><button className="icon-btn" onClick={logout} title="Sign out"><LogOut size={17}/></button></div>
      </aside>

      {sidebar && <div className="mobile-scrim" onClick={() => setSidebar(false)} />}

      <section className="workspace">
        <header className="topbar">
          <div className="top-left">
            {!sidebar && <button title="Open sidebar" className="icon-btn" onClick={() => setSidebar(true)}><Menu size={20}/></button>}
            <div className="model-wrap">
              <button className="model-button" onClick={() => setModelMenu(!modelMenu)}><Bot size={17}/>{currentModel.label}<ChevronDown size={15}/></button>
              {modelMenu && <div className="model-menu glass">{modelOptions.map(m => <button key={m.id} disabled={!m.available} onClick={() => { if (!m.available) return; setModel(m.id); savePreferences({ ...readPreferences(), model: m.id }); setModelMenu(false); }} className={model === m.id ? 'selected' : ''}><strong>{m.label}{!m.available ? ' · Locked' : ''}</strong><small>{m.hint}{m.tier && !m.available ? ` · ${m.tier.toUpperCase()} required` : ''}</small></button>)}</div>}
            </div>
            {activeProject && <div className="project-pill"><FolderKanban size={14}/><span>{activeProject.name}</span><button onClick={clearActiveProject} title="Leave project"><X size={12}/></button></div>}
            <button
              className={`temporary-pill ${temporaryMode ? 'active' : ''}`}
              onClick={temporaryMode ? () => newChat() : startTemporaryChat}
              title={temporaryMode ? 'Leave temporary chat' : 'Start a temporary chat without history or Memory'}
            ><Clock3 size={14}/>{temporaryMode ? 'Temporary' : 'Temporary chat'}</button>
          </div>
          <div className="top-actions">
            {activeChat && <button className="icon-btn conversation-action" onClick={() => forkConversation()} title="Branch conversation"><GitBranch size={17}/></button>}
            {activeChat && !temporaryMode && <button className="icon-btn conversation-action" onClick={shareActiveChat} disabled={sharing} title="Share conversation"><Share2 size={17}/></button>}
            {activeChat && <button className="icon-btn conversation-action" onClick={exportActiveChat} title="Export Markdown"><Download size={17}/></button>}
            <a className="usage-pill" href="/billing" title="Plan and usage"><Sparkles size={14}/><div><strong>{planName}</strong><small>{messageLimit > 0 ? `${messagesToday}/${messageLimit} today` : 'Plan & usage'}</small></div></a>
            <div className="status-pill" title={`Build v${packageJson.version}`}><span/> {aiMode === 'development' ? 'Development preview' : aiMode === 'demo' ? 'Demo preview' : 'Public Beta'}</div>
            {session.user.role === 'admin' && <a className="icon-btn" href="/admin" title="Admin"><ShieldCheck size={19}/></a>}
            <a className="profile-mini" href="/settings" title="Profile"><span>{session.user.display_name.slice(0, 1).toUpperCase()}</span><div><strong>{session.user.display_name}</strong><small>{planName}</small></div></a>
          </div>
        </header>

        {aiMode === 'development' && <div className="development-notice" role="status">Development preview: all UVMS models share a free router with variable availability. Images and voice are demo only. Web search is unavailable.</div>}
        {temporaryMode && <div className="temporary-notice" role="status"><Clock3 size={14}/><div><strong>Temporary chat</strong><span>Not shown in history · Memory and Projects are not used · {activeChatInfo?.expires_at ? `expires ${new Date(activeChatInfo.expires_at).toLocaleString()}` : 'expires 24 hours after the first message'} · Ctrl/⌘ + Shift + T</span></div><button onClick={() => newChat()}>Exit</button></div>}
        <div className="conversation" ref={conversationRef} onScroll={e => { const el = e.currentTarget; followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
          {loadingChat ? <div className="loading-thread" role="status"><div className="skeleton"/><div className="skeleton"/>Loading conversation…</div> : messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-logo"><Image src="/uvms-logo.png" width={62} height={62} alt="UVMS AI" /></div>
              <h1>Hello, <span>let’s build<br/>something amazing.</span></h1>
              <p>Your AI assistant for deeper thinking, brighter ideas and real progress.</p>
              <div className="welcome-badges"><span><ShieldCheck size={13}/> Private account</span><span><FileText size={13}/> Work with documents</span><span><FolderKanban size={13}/> Projects & memory</span></div>
              {activeProject && <div className="active-project-banner"><FolderKanban size={15}/> Working in <strong>{activeProject.name}</strong></div>}
              <div className="starter-grid">{STARTERS.filter(item => (item.title !== 'Search the web' || toolsAvailable.search) && (item.title !== 'Create images' || toolsAvailable.images)).map(({icon: Icon, title, text, disabled}) => <button key={title} disabled={disabled || (title === 'Search the web' && !toolsAvailable.search) || (title === 'Create images' && !toolsAvailable.images)} title={(title === 'Search the web' && !toolsAvailable.search) || (title === 'Create images' && !toolsAvailable.images) ? 'Currently unavailable' : undefined} onClick={() => { if (disabled) return; if (title === 'Analyze files') fileInputRef.current?.click(); else if (title === 'Search the web') { setImageMode(false); setWebSearch(true); setInput('What is happening today that I should know about?'); } else if (title === 'Create images') { setImageMode(true); setWebSearch(false); setInput('Create a premium futuristic UVMS technology workspace'); } else if (title === 'Work on projects') { window.location.href = '/projects'; } else if (title === 'Manage memory') window.location.href = '/memory'; else if (title === 'Temporary chat') startTemporaryChat(); }} className={disabled ? 'disabled' : ''}><Icon size={21}/><div><strong>{title}</strong><small>{text}</small></div><em>OPEN</em></button>)}</div>
              <div className="sync-note"><ShieldCheck size={16}/> One UVMS account keeps your chats synchronized across Web and Mobile.</div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((m) => (
                <article key={m.id} className={`message ${m.role}`}>
                  <div className="message-avatar">{m.role === 'assistant' ? <Image src="/uvms-logo.png" width={27} height={27} alt="AI"/> : <UserRound size={18}/>}</div>
                  <div className="message-body">
                    <div className="message-meta">{m.role === 'assistant' ? 'UVMS AI' : 'You'}{m.model_id && <span>{m.model_id}</span>}{m.meta?.demo && <em>DEMO</em>}{m.meta?.stopped && <em className="stopped">STOPPED</em>}</div>
                    {editingMessage === m.id ? (
                      <div className="message-editor">
                        <textarea value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus />
                        <div><button onClick={() => setEditingMessage(null)}><X size={14}/> Cancel</button><button className="save-edit" onClick={() => saveEdit(m)} disabled={!editValue.trim() || sending}><Check size={14}/> Save & regenerate</button></div>
                      </div>
                    ) : <>
                      {m.role === 'assistant' && m.id.startsWith('a-') && sending && <div className="assistant-activity"><span/><strong>{webSearch ? (searchStatus === 'searching' ? 'Searching…' : searchStatus === 'completed' ? 'Answer complete' : 'Reading sources…') : 'Thinking'}</strong></div>}
                      {m.role === 'assistant' && m.id.startsWith('a-') && sending && webSearch && searchStatus !== 'idle' && <div className={`search-activity ${searchStatus}`}><Globe2 size={13}/>{searchStatus === 'searching' ? 'Searching the web…' : searchStatus === 'demo' ? 'Demo search · no live sources' : searchStatus === 'failed' ? 'Search unavailable · answering without live sources' : searchStatus === 'reading' ? 'Reading sources…' : 'Answer complete'}</div>}
                      {m.meta?.web_search_status === 'failed' && <div className="search-activity">Web search was unavailable. This answer has no live sources.</div>}<div className="message-text">{m.content ? <MessageContent content={m.content} /> : (sending ? <span className="typing"><i/><i/><i/></span> : '')}</div>
                    </>}
                    {m.role === 'assistant' && m.meta?.citations && m.meta.citations.length > 0 && (
                      <div className="citation-list">
                        <div className="citation-title"><Globe2 size={13}/> Sources</div>
                        <div className="citation-grid">{m.meta.citations.filter(citation => safeLink(citation.url)).map((citation, index) => <a key={`${citation.url}-${index}`} href={citation.url} target="_blank" rel="noreferrer" className="citation-card"><span>{index + 1}</span><div><strong>{citation.title || new URL(citation.url).hostname}</strong><small>{new URL(citation.url).hostname.replace(/^www\./, '')}</small></div><ExternalLink size={12}/></a>)}</div>
                      </div>
                    )}
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="message-attachments">{m.attachments.map(file => file.category === 'image' ? (
                        <div className="generated-media" key={file.id}>
                          <SecureImage file={file} token={access} />
                          <div className="generated-media-meta"><div><ImageIcon size={14}/><span>{m.meta?.image_generation ? (m.meta?.demo ? 'UVMS demo image' : 'Generated by UVMS AI') : file.original_name}</span></div><button onClick={() => downloadFile(file).catch(e => setError(errorMessage(e)))} title="Download image">Download · {formatBytes(file.size_bytes)}</button></div>
                        </div>
                      ) : <div className="attachment-card" key={file.id} onClick={() => downloadFile(file).catch(e => setError(errorMessage(e)))} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') void downloadFile(file).catch(err => setError(errorMessage(err))); }}><FileText size={15}/><div><strong>{file.original_name}</strong><small>{file.category} · {formatBytes(file.size_bytes)}</small></div></div>)}</div>
                    )}
                    {editingMessage !== m.id && (m.content || (m.attachments && m.attachments.length > 0)) && (
                      <div className="message-tools">
                        <button onClick={() => copyMessage(m)} title="Copy">{copiedMessage === m.id ? <Check size={14}/> : <Copy size={14}/>}<span>{copiedMessage === m.id ? 'Copied' : 'Copy'}</span></button>
                        {activeChat && !m.id.startsWith('u-') && !m.id.startsWith('a-') && <button onClick={() => forkConversation(m)} disabled={sending} title="Branch from here"><GitBranch size={14}/><span>Branch</span></button>}
                        {m.role === 'user' && !m.id.startsWith('u-') && <button onClick={() => beginEdit(m)} title="Edit"><Pencil size={14}/><span>Edit</span></button>}
                        {m.role === 'assistant' && !m.id.startsWith('a-') && <button onClick={() => regenerate(m)} disabled={sending} title="Regenerate"><RotateCcw size={14}/><span>Regenerate</span></button>}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="composer-wrap">
          {error && <div className="inline-error" role="alert">{errorMessage(error)}{retry && <button disabled={sending} onClick={() => retry()}>Retry</button>}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></button></div>}
          <div className="composer glass" onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }} onDragLeave={e => e.currentTarget.classList.remove('drag-over')} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); if (!sending) chooseFiles(e.dataTransfer.files); }}>
            <input ref={fileInputRef} className="hidden-file-input" type="file" multiple accept="image/*,.pdf,.docx,.xlsx,.txt,.md,.csv,.json,.py,.js,.jsx,.ts,.tsx,.html,.css,.sql,.yaml,.yml,.xml,.log" onChange={e => chooseFiles(e.target.files)} />
            {pendingFiles.length > 0 && <div className="attachment-queue">{pendingFiles.map((file, index) => <div className="pending-file" key={`${file.name}-${index}`}>{file.type.startsWith('image/') ? <PendingImage file={file}/> : <FileText size={14}/>}<div><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></div><button onClick={() => removePendingFile(index)} title="Remove"><X size={13}/></button></div>)}</div>}
            {webSearch && !imageMode && <div className="composer-mode-bar"><div><Globe2 size={14}/><strong>Web search</strong><span>Fresh answers with source citations</span></div><button onClick={() => setWebSearch(false)} title="Turn off web search"><X size={13}/></button></div>}
            {imageMode && <div className="image-mode-bar"><div><ImageIcon size={14}/><strong>Image mode</strong><span>Describe what you want to create</span></div><select value={imageSize} onChange={e => setImageSize(e.target.value)}><option value="1024x1024">Square</option><option value="1536x1024">Landscape</option><option value="1024x1536">Portrait</option></select></div>}
            {(runtimeLabel || voice.transcribing || voice.requesting) && <div className="runtime-strip"><i/><span>{voice.requesting ? 'Requesting microphone…' : voice.transcribing ? 'Transcribing…' : uploadProgress || runtimeLabel}</span>{listening && <button onClick={voice.cancel}>Cancel recording</button>}</div>}
            <textarea ref={composerRef} aria-label="Message" disabled={loadingChat} value={input} onChange={e => setInput(e.target.value)} placeholder={imageMode ? "Describe an image..." : pendingFiles.length ? "Ask about your files..." : "Ask anything..."} rows={1} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
            <div className="composer-actions"><div><button className="chip" disabled={sending || imageMode} onClick={() => fileInputRef.current?.click()} title="Attach file"><Plus size={17}/></button><button className={`chip ${webSearch ? 'chip-active' : ''}`} aria-pressed={webSearch} disabled={imageMode || sending || !toolsAvailable.search} onClick={() => setWebSearch(value => !value)} title={toolsAvailable.search ? "Search the web with citations" : "Search is currently unavailable"}><Globe2 size={16}/> {webSearch ? 'Search on' : 'Search'}</button><button className="chip" onClick={() => fileInputRef.current?.click()} disabled={imageMode || sending}><FileText size={16}/> Attach</button><button className={`chip ${imageMode ? 'chip-active' : ''}`} disabled={sending || !toolsAvailable.images} title={toolsAvailable.images ? "Create image" : "Images are currently unavailable"} aria-pressed={imageMode} onClick={() => { setImageMode(v => !v); setWebSearch(false); }}><ImageIcon size={16}/> Image</button></div><div>{uploadingFiles && <span className="uploading-label">Uploading…</span>}<button className={`chip icon-only ${listening ? 'chip-active listening' : ''}`} onClick={voice.toggle} disabled={sending || voice.transcribing || voice.requesting || (!toolsAvailable.voice && !listening)} title={listening ? 'Stop recording' : toolsAvailable.voice ? 'Voice input' : 'Voice is currently unavailable'} aria-pressed={listening}><Mic size={17}/></button>{sending ? (imageMode ? <button className="send-btn stop-btn" disabled title="Creating image"><Square size={15} fill="currentColor"/></button> : <button className="send-btn stop-btn" onClick={stopGeneration} title="Stop generation"><Square size={15} fill="currentColor"/></button>) : <button className="send-btn" onClick={() => send()} title="Send message" disabled={loadingChat || listening || voice.transcribing || (!input.trim() && !pendingFiles.length)}><ArrowUp size={20}/></button>}</div></div>
          </div>
          <p className="disclaimer">UVMS AI can make mistakes. Verify important information.</p>
        </div>
      </section>
      {shareDialog && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.currentTarget === e.target) setShareDialog(null); }}>
        <section className="share-dialog glass" role="dialog" aria-modal="true" aria-labelledby="share-title">
          <div className="share-dialog-head"><div><Share2 size={18}/><div><small>PUBLIC SNAPSHOT</small><h2 id="share-title">Share conversation</h2></div></div><button className="icon-btn" onClick={() => setShareDialog(null)} title="Close"><X size={18}/></button></div>
          <p>This link contains an immutable snapshot of <strong>{shareDialog.title}</strong>. Later edits to your private chat will not change the shared copy.</p>
          <div className="share-link-box"><span>{shareDialog.url}</span><button onClick={() => { void copyText(shareDialog.url); toast('Link copied.', 'success'); }}><Copy size={14}/> Copy</button></div>
          <div className="share-dialog-actions"><button className="danger-outline" onClick={revokeShare}><Trash2 size={14}/> Revoke link</button><a className="secondary-small" href="/shares"><Share2 size={14}/> Manage shares</a><a className="primary-small" href={shareDialog.url} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Open shared view</a></div>
        </section>
      </div>}
    </main>
  );
}

