import * as SecureStore from 'expo-secure-store';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { fetch as expoFetch } from 'expo/fetch';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  FlatList,
  Image,
  KeyboardAvoidingView,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from 'react-native';

import { consumeSse, type SseFrame } from './src/sse';
import appConfig from './app.json';
import type {
  Chat,
  Checkout,
  DeviceSession,
  FileAsset,
  Memory,
  ModelInfo,
  Msg,
  PickedFile,
  Plan,
  Project,
  Screen,
  SharedChatRecord,
  Session,
  Subscription,
  Usage,
} from './src/types';

const CONFIGURED_API = process.env.EXPO_PUBLIC_API_URL?.trim();
const API_CONFIGURATION_MISSING = !CONFIGURED_API && !__DEV__;
const API = (CONFIGURED_API || 'http://localhost:8000/api/v1').replace(/\/+$/, '');
const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || '').replace(/\/+$/, '');
const SESSION_KEY = 'uvms-session';
const MODEL_KEY = 'uvms-mobile-model';
const MAX_ATTACHMENTS = 8;
const LOOPBACK_API = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/)/i.test(API);
let sessionStorageWrite: Promise<void> = Promise.resolve();

async function readStoredSession(): Promise<Session | null> {
  try {
    await sessionStorageWrite;
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<Session>;
    if (typeof candidate.access !== 'string' || typeof candidate.refresh !== 'string'
      || !candidate.user || typeof candidate.user.id !== 'string'
      || typeof candidate.user.display_name !== 'string' || typeof candidate.user.email !== 'string'
      || typeof candidate.user.role !== 'string') return null;
    return candidate as Session;
  } catch {
    return null;
  }
}

async function writeStoredSession(value: Session | null) {
  const write = sessionStorageWrite.then(() => value
    ? SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(value))
    : SecureStore.deleteItemAsync(SESSION_KEY));
  sessionStorageWrite = write.catch(() => undefined);
  await write;
}

async function readStoredModel(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(MODEL_KEY); } catch { return null; }
}

async function writeStoredModel(value: string) {
  try { await SecureStore.setItemAsync(MODEL_KEY, value); } catch { /* preference only */ }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(milliseconds: number) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(total / 60).toString().padStart(2, '0');
  const seconds = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = await response.json() as any;
    const detail = body?.error?.message ?? body?.detail ?? body?.message;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (detail && typeof detail === 'object' && typeof detail.message === 'string') return detail.message;
  } catch { /* non-json response */ }
  return fallback;
}

function friendlyNetworkError(error: unknown, fallback = 'Request failed') {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'Request cancelled.';
    const message = error.message.trim();
    if (/network request failed|failed to fetch|networkerror|connection/i.test(message)) {
      return 'Could not connect to UVMS AI. Check Wi‑Fi and the API address, then retry.';
    }
    if (message) return message;
  }
  return fallback;
}

function haptic(duration = 8) {
  // Android supports short vibration durations. iOS' React Native Vibration API
  // uses a much longer system vibration, so visual press physics are preferred
  // there until expo-haptics is added as a first-class dependency.
  if (Platform.OS === 'android') Vibration.vibrate(duration);
}

function InlineMarkdown({ text, style }: { text: string; style?: any }) {
  const token = /(\[[^\]]+\]\(https?:\/\/[^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  const parts = text.split(token).filter(Boolean);
  return (
    <Text selectable style={[s.mdText, style]}>
      {parts.map((part, index) => {
        const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
        if (link) return <Text key={index} style={s.mdLink} onPress={() => Linking.openURL(link[2])}>{link[1]}</Text>;
        if (part.startsWith('`') && part.endsWith('`')) return <Text key={index} style={s.mdInlineCode}>{part.slice(1, -1)}</Text>;
        if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <Text key={index} style={s.mdBold}>{part.slice(2, -2)}</Text>;
        if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) return <Text key={index} style={s.mdItalic}>{part.slice(1, -1)}</Text>;
        return <Text key={index}>{part}</Text>;
      })}
    </Text>
  );
}

function RichMessage({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  let code: string[] | null = null;
  let language = '';

  const flushCode = (key: string) => {
    if (!code) return;
    nodes.push(
      <View key={key} style={s.codeBlock}>
        <View style={s.codeHeader}>
          <Text style={s.codeLanguage}>{language || 'code'}</Text>
          <Text style={s.codeHint}>Long-press text to copy</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.codeContent}>
          <Text selectable style={s.codeText}>{code.join('\n').replace(/\n+$/, '')}</Text>
        </ScrollView>
      </View>,
    );
    code = null;
    language = '';
  };

  lines.forEach((raw, index) => {
    const fence = raw.match(/^```\s*([^`]*)$/);
    if (fence) {
      if (code) flushCode(`code-${index}`);
      else { code = []; language = fence[1].trim(); }
      return;
    }
    if (code) { code.push(raw); return; }

    const line = raw.trimEnd();
    if (!line.trim()) {
      nodes.push(<View key={`space-${index}`} style={s.mdSpacer}/>);
      return;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      nodes.push(<InlineMarkdown key={`h-${index}`} text={heading[2]} style={level === 1 ? s.mdH1 : level === 2 ? s.mdH2 : s.mdH3}/>);
      return;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      nodes.push(<View key={`q-${index}`} style={s.mdQuote}><InlineMarkdown text={quote[1]} style={s.mdQuoteText}/></View>);
      return;
    }
    const unordered = line.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      nodes.push(<View key={`ul-${index}`} style={s.mdListRow}><Text style={s.mdBullet}>•</Text><InlineMarkdown text={unordered[1]} style={s.mdListText}/></View>);
      return;
    }
    const ordered = line.match(/^(\d+)\.\s+(.+)$/);
    if (ordered) {
      nodes.push(<View key={`ol-${index}`} style={s.mdListRow}><Text style={s.mdOrder}>{ordered[1]}.</Text><InlineMarkdown text={ordered[2]} style={s.mdListText}/></View>);
      return;
    }
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
      nodes.push(<View key={`hr-${index}`} style={s.mdHr}/>);
      return;
    }
    const looksLikeTable = line.includes('|') && line.split('|').filter(Boolean).length >= 2;
    if (looksLikeTable) {
      nodes.push(<ScrollView key={`table-${index}`} horizontal showsHorizontalScrollIndicator={false}><Text selectable style={s.mdTable}>{line}</Text></ScrollView>);
      return;
    }
    nodes.push(<InlineMarkdown key={`p-${index}`} text={line}/>);
  });
  if (code) flushCode('code-final');
  return <View style={s.richMessage}>{nodes}</View>;
}

function StatusDot({ online }: { online: boolean }) {
  return <View style={[s.statusDot, online ? s.statusOnline : s.statusOffline]} />;
}

export default function App() {
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}><AppContent /></SafeAreaProvider>;
}

function AppContent() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [screen, setScreen] = useState<Screen>('home');
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [activeChatInfo, setActiveChatInfo] = useState<Chat | null>(null);
  const [temporaryMode, setTemporaryMode] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [webSearch, setWebSearch] = useState(false);
  const [aiMode, setAiMode] = useState('');
  const [imagesMode, setImagesMode] = useState('');
  const [voiceMode, setVoiceMode] = useState('');
  const [searchAvailable, setSearchAvailable] = useState(true);
  const [imagesAvailable, setImagesAvailable] = useState(true);
  const [voiceAvailable, setVoiceAvailable] = useState(true);
  const [visionAvailable, setVisionAvailable] = useState(true);
  const [billingEnabled, setBillingEnabled] = useState(true);
  const [imageMode, setImageMode] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PickedFile[]>([]);
  const [pendingAssets, setPendingAssets] = useState<FileAsset[]>([]);
  const [uploading, setUploading] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectInstructions, setProjectInstructions] = useState('');
  const [projectFiles, setProjectFiles] = useState<FileAsset[]>([]);
  const [projectChats, setProjectChats] = useState<Chat[]>([]);

  const [memory, setMemory] = useState<Memory[]>([]);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [libraryFiles, setLibraryFiles] = useState<FileAsset[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryOpenedFromChat, setLibraryOpenedFromChat] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileAsset | null>(null);
  const [sharedLinks, setSharedLinks] = useState<SharedChatRecord[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);

  const [usage, setUsage] = useState<Usage | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deviceSessions, setDeviceSessions] = useState<DeviceSession[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('uvms-1-balanced');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [messageMenu, setMessageMenu] = useState<Msg | null>(null);
  const [providerName, setProviderName] = useState('');
  const [textLive, setTextLive] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'thinking' | 'searching' | 'reading' | 'streaming' | 'syncing' | 'stopping'>('idle');
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [retryMessageId, setRetryMessageId] = useState<string | null>(null);
  const generationController = useRef<AbortController | null>(null);
  const imageController = useRef<AbortController | null>(null);
  const submissionLock = useRef<symbol | null>(null);
  const chatViewEpoch = useRef(0);
  const projectViewEpoch = useRef(0);
  const authEpoch = useRef(0);
  const refreshLock = useRef<Promise<Session | null> | null>(null);
  const threadRef = useRef<FlatList<Msg>>(null);
  const userNearBottom = useRef(true);
  const currentAppState = useRef(AppState.currentState);
  const screenOpacity = useRef(new Animated.Value(1)).current;

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 250);
  const recordingActive = useRef(false);
  const recordingTransition = useRef(false);
  const [transcribing, setTranscribing] = useState(false);

  useEffect(() => {
    Promise.all([readStoredSession(), readStoredModel()]).then(([storedSession, storedModel]) => {
      if (storedSession) {
        setSession(storedSession);
        setDisplayName(storedSession.user.display_name);
      }
      if (storedModel) setSelectedModel(storedModel);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
  }, []);

  useEffect(() => {
    screenOpacity.setValue(0.3);
    Animated.timing(screenOpacity, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [screen, screenOpacity]);

  useEffect(() => {
    if (screen !== 'library') setLibraryOpenedFromChat(false);
  }, [screen]);

  const headers = useCallback(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access}` }), [session?.access]);
  const authOnly = useCallback(() => ({ Authorization: `Bearer ${session?.access}` }), [session?.access]);

  function clearPrivateState() {
    authEpoch.current += 1;
    chatViewEpoch.current += 1;
    projectViewEpoch.current += 1;
    generationController.current?.abort();
    generationController.current = null;
    imageController.current?.abort();
    imageController.current = null;
    if (recordingActive.current) {
      recordingActive.current = false;
      void audioRecorder.stop().catch(() => undefined);
    }
    recordingTransition.current = false;
    void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
    submissionLock.current = null;
    setSession(null);
    setChats([]);
    setMessages([]);
    setChatId(null);
    setActiveChatInfo(null);
    setTemporaryMode(false);
    setActiveProject(null);
    setProjects([]);
    setProjectFiles([]);
    setProjectChats([]);
    setProjectName('');
    setProjectDescription('');
    setProjectInstructions('');
    setMemory([]);
    setMemoryDraft('');
    setLibraryFiles([]);
    setLibraryLoading(false);
    setLibraryOpenedFromChat(false);
    setSharedLinks([]);
    setSharesLoading(false);
    setUsage(null);
    setPlans([]);
    setModels([]);
    setSubscription(null);
    setCheckout(null);
    setDeviceSessions([]);
    setPreviewFile(null);
    setPendingFiles([]);
    setPendingAssets([]);
    setUploading(false);
    setTranscribing(false);
    setInput('');
    setWebSearch(false);
    setImageMode(false);
    setRetryMessageId(null);
    setActiveRequestId(null);
    setGenerating(false);
    setGenerationStatus('idle');
    setBusy(false);
    setModelPickerOpen(false);
    setAttachmentSheetOpen(false);
    setChatMenuOpen(false);
    setMessageMenu(null);
    setScreen('home');
    setDisplayName('');
    setPassword('');
    setCurrentPassword('');
    setNewPassword('');
    setError('');
  }

  const refreshSession = useCallback(async (): Promise<Session | null> => {
    if (refreshLock.current) return refreshLock.current;
    refreshLock.current = (async () => {
      const epoch = authEpoch.current;
      const current = (await readStoredSession()) || session;
      if (epoch !== authEpoch.current) return null;
      if (!current?.refresh) return null;
      try {
        const response = await fetch(`${API}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: current.refresh }),
        });
        if (epoch !== authEpoch.current) return null;
        if (response.status === 401 || response.status === 403) {
          clearPrivateState();
          await writeStoredSession(null);
          return null;
        }
        if (!response.ok) throw new Error(await responseMessage(response, 'Unable to reconnect.'));
        const body = await response.json();
        if (epoch !== authEpoch.current) return null;
        const next: Session = { access: body.access_token, refresh: body.refresh_token, user: body.user };
        await writeStoredSession(next);
        if (epoch !== authEpoch.current) return null;
        setSession(next);
        setDisplayName(next.user.display_name);
        setOnline(true);
        return next;
      } catch (e) {
        if (epoch === authEpoch.current) {
          setOnline(false);
          setError(friendlyNetworkError(e, 'Could not reconnect.'));
        }
        return null;
      } finally {
        refreshLock.current = null;
      }
    })();
    return refreshLock.current;
  }, [session]);

  const request = useCallback(async (path: string, init: RequestInit = {}): Promise<Response> => {
    const url = path.startsWith('http') ? path : `${API}${path}`;
    const current = (await readStoredSession()) || session;
    const headersValue = new Headers(init.headers as HeadersInit | undefined);
    if (current?.access) headersValue.set('Authorization', `Bearer ${current.access}`);
    try {
      let response = await fetch(url, { ...init, headers: headersValue });
      if (response.status !== 401 || path.includes('/auth/')) {
        setOnline(true);
        return response;
      }
      const latest = await readStoredSession();
      const refreshed = latest && latest.access !== current?.access ? latest : await refreshSession();
      if (!refreshed) return response;
      const retryHeaders = new Headers(init.headers as HeadersInit | undefined);
      retryHeaders.set('Authorization', `Bearer ${refreshed.access}`);
      response = await fetch(url, { ...init, headers: retryHeaders });
      setOnline(true);
      return response;
    } catch (e) {
      setOnline(false);
      throw e;
    }
  }, [refreshSession, session]);

  const streamRequest = useCallback(async (path: string, init: RequestInit = {}) => {
    const url = path.startsWith('http') ? path : `${API}${path}`;
    const current = (await readStoredSession()) || session;
    const make = async (access?: string) => {
      const h = new Headers(init.headers as HeadersInit | undefined);
      if (access) h.set('Authorization', `Bearer ${access}`);
      return expoFetch(url, { ...(init as any), headers: h } as any);
    };
    try {
      let response = await make(current?.access);
      if (response.status !== 401 || path.includes('/auth/')) {
        setOnline(true);
        return response;
      }
      const latest = await readStoredSession();
      const refreshed = latest && latest.access !== current?.access ? latest : await refreshSession();
      if (!refreshed) return response;
      response = await make(refreshed.access);
      setOnline(true);
      return response;
    } catch (e) {
      setOnline(false);
      throw e;
    }
  }, [refreshSession, session]);

  const loadCore = useCallback(async () => {
    if (!session) return;
    const epoch = authEpoch.current;
    try {
      const [chatResponse, projectResponse, memoryResponse, usageResponse, plansResponse, subscriptionResponse, modelsResponse, capabilitiesResponse] = await Promise.all([
        request('/chats', { headers: headers() }),
        request('/projects', { headers: headers() }),
        request('/memory', { headers: headers() }),
        request('/usage/me', { headers: headers() }),
        request('/plans', { headers: headers() }),
        request('/billing/subscription', { headers: headers() }),
        request('/models', { headers: headers() }),
        request('/capabilities', { headers: headers() }),
      ]);
      const [chatRows, projectRows, memoryRows, usageValue, planRows, subscriptionValue, modelRows, capabilityInfo] = await Promise.all([
        chatResponse.ok ? chatResponse.json() : null,
        projectResponse.ok ? projectResponse.json() : null,
        memoryResponse.ok ? memoryResponse.json() : null,
        usageResponse.ok ? usageResponse.json() : null,
        plansResponse.ok ? plansResponse.json() : null,
        subscriptionResponse.ok ? subscriptionResponse.json() : null,
        modelsResponse.ok ? modelsResponse.json() : null,
        capabilitiesResponse.ok ? capabilitiesResponse.json() : null,
      ]);
      if (epoch !== authEpoch.current) return;
      if (chatRows) setChats(chatRows);
      if (projectRows) setProjects(projectRows);
      if (memoryRows) setMemory(memoryRows);
      if (usageValue) setUsage(usageValue);
      if (planRows) setPlans(planRows);
      if (subscriptionValue) setSubscription(subscriptionValue);
      if (modelsResponse.ok) {
        const rows: ModelInfo[] = modelRows;
        setModels(rows);
        const saved = await readStoredModel();
        if (epoch !== authEpoch.current) return;
        const desired = saved || selectedModel;
        if (!rows.some(row => row.id === desired && row.available)) {
          const first = rows.find(row => row.available);
          if (first) {
            setSelectedModel(first.id);
            await writeStoredModel(first.id);
          }
        } else if (desired !== selectedModel) {
          setSelectedModel(desired);
        }
      }
      if (capabilityInfo) {
        const info = capabilityInfo;
        setAiMode(info.ai_mode || '');
        setProviderName(info.provider || '');
        setTextLive(Boolean(info.text_live));
        setImagesMode(info.images_mode || '');
        setVoiceMode(info.voice_mode || '');
        setSearchAvailable(Boolean(info.search));
        setImagesAvailable(Boolean(info.images));
        setVoiceAvailable(Boolean(info.voice));
        setVisionAvailable(info.vision !== false);
        setBillingEnabled(Boolean(info.billing_enabled));
        if (!info.search) setWebSearch(false);
      }
      if (epoch === authEpoch.current) setOnline(true);
    } catch {
      if (epoch === authEpoch.current) setOnline(false);
    }
  }, [headers, request, selectedModel, session]);

  const loadLibrary = useCallback(async () => {
    if (!session) return;
    const epoch = authEpoch.current;
    setLibraryLoading(true);
    try {
      const response = await request('/files', { headers: headers() });
      if (!response.ok) throw new Error(await responseMessage(response, 'Could not load Library.'));
      const files = await response.json();
      if (epoch === authEpoch.current) setLibraryFiles(files);
    } catch (e) {
      if (epoch === authEpoch.current) setError(friendlyNetworkError(e, 'Could not load Library.'));
    } finally {
      if (epoch === authEpoch.current) setLibraryLoading(false);
    }
  }, [headers, request, session]);

  const loadShares = useCallback(async () => {
    if (!session) return;
    const epoch = authEpoch.current;
    setSharesLoading(true);
    try {
      const response = await request('/shares?include_revoked=true', { headers: headers() });
      if (!response.ok) throw new Error(await responseMessage(response, 'Could not load shared links.'));
      const rows = await response.json();
      if (epoch === authEpoch.current) setSharedLinks(rows);
    } catch (e) {
      if (epoch === authEpoch.current) setError(friendlyNetworkError(e, 'Could not load shared links.'));
    } finally {
      if (epoch === authEpoch.current) setSharesLoading(false);
    }
  }, [headers, request, session]);

  async function revokeSharedLink(item: SharedChatRecord) {
    if (item.revoked_at) return;
    try {
      const response = await request(`/shares/${item.id}`, { method: 'DELETE', headers: authOnly() });
      if (!response.ok) throw new Error(await responseMessage(response, 'Could not revoke shared link.'));
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      await loadShares();
    } catch (e) { setError(friendlyNetworkError(e, 'Could not revoke shared link.')); }
  }

  function confirmRevokeSharedLink(item: SharedChatRecord) {
    Alert.alert('Revoke shared snapshot?', 'Anyone with its original public link will lose access immediately.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => { void revokeSharedLink(item); } },
    ]);
  }

  const refreshProjectContents = useCallback(async (project: Project) => {
      const authVersion = authEpoch.current;
      const projectVersion = projectViewEpoch.current;
      const [filesResponse, chatsResponse] = await Promise.all([
        request(`/projects/${project.id}/files`, { headers: headers() }),
        request(`/projects/${project.id}/chats`, { headers: headers() }),
      ]);
      if (!filesResponse.ok) throw new Error(await responseMessage(filesResponse, 'Could not load project files.'));
      if (!chatsResponse.ok) throw new Error(await responseMessage(chatsResponse, 'Could not load project chats.'));
      const [files, chats] = await Promise.all([filesResponse.json(), chatsResponse.json()]);
      if (authVersion !== authEpoch.current || projectVersion !== projectViewEpoch.current) return;
      setProjectFiles(files);
      setProjectChats(chats);
  }, [headers, request]);

  const loadProjectDetail = useCallback(async (project: Project) => {
    const projectVersion = ++projectViewEpoch.current;
    setActiveProject(project);
    setProjectName(project.name);
    setProjectDescription(project.description || '');
    setProjectInstructions(project.instructions || '');
    setBusy(true);
    try {
      await refreshProjectContents(project);
      if (projectVersion === projectViewEpoch.current) setScreen('projectDetail');
    } catch (e) {
      if (projectVersion === projectViewEpoch.current) setError(friendlyNetworkError(e, 'Could not open project.'));
    } finally {
      if (projectVersion === projectViewEpoch.current) setBusy(false);
    }
  }, [refreshProjectContents]);

  useEffect(() => { if (session) loadCore(); }, [session, loadCore]);

  useEffect(() => {
    const subscriptionHandle = AppState.addEventListener('change', next => {
      const wasBackground = currentAppState.current.match(/inactive|background/);
      currentAppState.current = next;
      if (wasBackground && next === 'active' && session) {
        loadCore();
        if (screen === 'library') loadLibrary();
        if (screen === 'shares') loadShares();
        if (screen === 'account') loadAccount();
        if (screen === 'projectDetail' && activeProject) refreshProjectContents(activeProject).catch(e => setError(friendlyNetworkError(e, 'Could not refresh project.')));
      }
    });
    return () => subscriptionHandle.remove();
  }, [activeProject, loadCore, loadLibrary, loadShares, refreshProjectContents, screen, session]);

  useEffect(() => () => {
    generationController.current?.abort();
    imageController.current?.abort();
  }, []);

  async function auth() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API}/auth/${register ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(register ? { email, password, display_name: name || 'UVMS User' } : { email, password }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Authentication failed'));
      const body = await response.json();
      const next: Session = { access: body.access_token, refresh: body.refresh_token, user: body.user };
      await writeStoredSession(next);
      setSession(next);
      setDisplayName(next.user.display_name);
      setPassword('');
      setOnline(true);
    } catch (e) {
      setOnline(false);
      setError(friendlyNetworkError(e, 'Authentication failed'));
    } finally {
      setBusy(false);
    }
  }

  async function refreshChat(id: string, projectHint?: Project | null, viewEpoch = chatViewEpoch.current) {
    const response = await request(`/chats/${id}`, { headers: headers() });
    if (!response.ok) throw new Error(await responseMessage(response, 'Could not refresh chat'));
    const body = await response.json();
    if (viewEpoch !== chatViewEpoch.current) return body;
    setChatId(id);
    setActiveChatInfo(body);
    setTemporaryMode(Boolean(body.is_temporary));
    setMessages(body.messages || []);
    if (projectHint) setActiveProject(projectHint);
    else if (body.project?.id) {
      setActiveProject(projects.find(project => project.id === body.project.id) || {
        id: body.project.id,
        name: body.project.name || 'Project',
        description: '',
        instructions: '',
      });
    } else setActiveProject(null);
    return body;
  }

  async function openChat(id: string, projectHint?: Project | null) {
    const viewEpoch = ++chatViewEpoch.current;
    void cancelVoiceRecording();
    generationController.current?.abort();
    generationController.current = null;
    imageController.current?.abort();
    imageController.current = null;
    submissionLock.current = null;
    setGenerating(false);
    setGenerationStatus('idle');
    setBusy(true);
    setError('');
    try {
      await refreshChat(id, projectHint, viewEpoch);
      if (viewEpoch !== chatViewEpoch.current) return;
      setRetryMessageId(null);
      setScreen('chat');
    } catch (e) {
      if (viewEpoch === chatViewEpoch.current) setError(friendlyNetworkError(e, 'Could not open chat'));
    } finally {
      if (viewEpoch === chatViewEpoch.current) setBusy(false);
    }
  }

  function selectModel(model: ModelInfo) {
    if (!model.available) {
      Alert.alert('Plan required', `${model.name} is available from the ${model.tier} plan.`);
      return;
    }
    haptic();
    setSelectedModel(model.id);
    writeStoredModel(model.id);
    setModelPickerOpen(false);
  }

  function newChat(project: Project | null = activeProject, temporary = false) {
    haptic();
    void cancelVoiceRecording();
    chatViewEpoch.current += 1;
    generationController.current?.abort();
    generationController.current = null;
    imageController.current?.abort();
    imageController.current = null;
    submissionLock.current = null;
    setGenerating(false);
    setBusy(false);
    setChatId(null);
    setActiveChatInfo(null);
    setTemporaryMode(temporary);
    setMessages([]);
    setInput('');
    setPendingFiles([]);
    setPendingAssets([]);
    setRetryMessageId(null);
    setActiveRequestId(null);
    setGenerationStatus('idle');
    setActiveProject(temporary ? null : project);
    setScreen('chat');
  }

  async function togglePin(chat: Chat) {
    try {
      const response = await request(`/chats/${chat.id}`, {
        method: 'PATCH', headers: headers(), body: JSON.stringify({ is_pinned: !chat.is_pinned }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Could not update chat'));
      await loadCore();
    } catch (e) { setError(friendlyNetworkError(e, 'Could not update chat')); }
  }

  async function branchChat(throughMessageId?: string) {
    if (!chatId) return;
    try {
      haptic();
      const response = await request(`/chats/${chatId}/fork`, {
        method: 'POST', headers: headers(), body: JSON.stringify(throughMessageId ? { through_message_id: throughMessageId } : {}),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Could not branch conversation'));
      const body = await response.json();
      await loadCore();
      await openChat(body.id);
    } catch (e) { setError(friendlyNetworkError(e, 'Could not branch conversation')); }
  }

  async function shareConversation() {
    if (!chatId || temporaryMode) return;
    if (!WEB_URL) {
      Alert.alert('Web URL needed', 'Set EXPO_PUBLIC_WEB_URL to your UVMS AI web address to share conversations from mobile.');
      return;
    }
    try {
      const response = await request(`/chats/${chatId}/share`, { method: 'POST', headers: headers() });
      if (!response.ok) throw new Error(await responseMessage(response, 'Could not create share link'));
      const body = await response.json();
      haptic();
      await Share.share({ message: `${body.title}\n${WEB_URL}/share/${encodeURIComponent(body.url_token)}` });
    } catch (e) { setError(friendlyNetworkError(e, 'Could not share conversation')); }
  }

  async function pickDocuments() {
    try {
      const available = MAX_ATTACHMENTS - pendingFiles.length - pendingAssets.length;
      if (available <= 0) { setError('A chat can include up to 8 attachments. Remove one before adding another.'); return; }
      haptic();
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
        type: '*/*',
      });
      if (result.canceled) return;
      const picked = result.assets.map(asset => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType || 'application/octet-stream',
        size: asset.size,
      }));
      if (!visionAvailable && picked.some(asset => asset.mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(asset.name))) {
        setError('Vision is temporarily unavailable (Beta). You can still attach documents.'); return;
      }
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setPendingFiles(current => [...current, ...picked].slice(0, MAX_ATTACHMENTS - pendingAssets.length));
      if (picked.length > available) setError('A chat can include up to 8 attachments. Only the first files were added.');
    } catch (e) {
      setError(friendlyNetworkError(e, 'Could not pick a file'));
    }
  }

  async function pickPhoto(fromCamera: boolean) {
    if (!visionAvailable) { Alert.alert('Vision unavailable (Beta)', 'Image analysis is temporarily unavailable. You can still attach documents.'); return; }
    try {
      const available = MAX_ATTACHMENTS - pendingFiles.length - pendingAssets.length;
      if (available <= 0) { setError('A chat can include up to 8 attachments. Remove one before adding another.'); return; }
      haptic();
      const permission = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', fromCamera ? 'Allow camera access to take a photo.' : 'Allow photo access to attach an image.');
        return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, allowsMultipleSelection: true });
      if (result.canceled) return;
      const picked = result.assets.map((asset, index) => ({
        uri: asset.uri,
        name: asset.fileName || `uvms-photo-${Date.now()}-${index}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
        size: asset.fileSize,
      }));
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setPendingFiles(current => [...current, ...picked].slice(0, MAX_ATTACHMENTS - pendingAssets.length));
      if (picked.length > available) setError('A chat can include up to 8 attachments. Only the first images were added.');
    } catch (e) {
      setError(friendlyNetworkError(e, 'Could not access images'));
    }
  }

  async function toggleVoiceRecording() {
    if (transcribing || busy || generating || !voiceAvailable || recordingTransition.current) return;
    recordingTransition.current = true;
    const epoch = authEpoch.current;
    const viewEpoch = chatViewEpoch.current;
    let startedRecording = false;
    try {
      if (!recordingActive.current) {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (epoch !== authEpoch.current || viewEpoch !== chatViewEpoch.current) return;
        if (!permission.granted) {
          Alert.alert('Microphone permission', 'Allow microphone access to dictate a message.');
          return;
        }
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
        await audioRecorder.prepareToRecordAsync();
        if (epoch !== authEpoch.current || viewEpoch !== chatViewEpoch.current) return;
        audioRecorder.record();
        recordingActive.current = true;
        startedRecording = true;
        return;
      }

      recordingActive.current = false;
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) throw new Error('No voice recording was created');
      setTranscribing(true);
      const form = new FormData();
      form.append('audio', { uri, name: 'uvms-voice.m4a', type: 'audio/mp4' } as any);
      const response = await request('/audio/transcribe', { method: 'POST', headers: authOnly(), body: form });
      if (!response.ok) throw new Error(await responseMessage(response, 'Voice transcription failed'));
      const body = await response.json();
      if (epoch !== authEpoch.current || viewEpoch !== chatViewEpoch.current) return;
      if (body.demo) Alert.alert('Demo voice', 'Recording was received. Live transcription is unavailable in this development provider mode.');
      else if (typeof body.text === 'string' && body.text.trim()) setInput(current => current ? `${current} ${body.text.trim()}` : body.text.trim());
    } catch (e) {
      if (epoch === authEpoch.current && viewEpoch === chatViewEpoch.current) setError(friendlyNetworkError(e, 'Voice transcription failed'));
    } finally {
      if (epoch === authEpoch.current) {
        recordingTransition.current = false;
        setTranscribing(false);
      }
      if (!startedRecording && !recordingActive.current) {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
      }
    }
  }

  async function cancelVoiceRecording() {
    if ((!recordingActive.current && !recorderState.isRecording) || recordingTransition.current) return;
    recordingTransition.current = true;
    recordingActive.current = false;
    try { await audioRecorder.stop(); } catch { /* discard */ }
    finally {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
      recordingTransition.current = false;
      setTranscribing(false);
    }
  }

  async function uploadPicked(files: PickedFile[], project: Project | null = activeProject) {
    const uploaded: FileAsset[] = [];
    setUploading(true);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('upload', { uri: file.uri, name: file.name, type: file.mimeType } as any);
        if (project) form.append('project_id', project.id);
        const response = await request('/files', { method: 'POST', headers: authOnly(), body: form });
        if (!response.ok) throw new Error(await responseMessage(response, `Upload failed: ${file.name}`));
        uploaded.push(await response.json());
      }
      return uploaded;
    } finally {
      setUploading(false);
    }
  }

  async function streamPrompt(options: { content: string; attachmentIds: string[]; retryId?: string | null; optimisticUser?: Msg | null }) {
    if (generationController.current) return;
    const controller = new AbortController();
    const viewEpoch = chatViewEpoch.current;
    generationController.current = controller;
    const isCurrentView = () => viewEpoch === chatViewEpoch.current && generationController.current === controller;
    setGenerating(true);
    setGenerationStatus('thinking');
    setActiveRequestId(null);
    setRetryMessageId(null);
    setError('');

    const assistantId = `a-stream-${Date.now()}`;
    let assistantCreated = false;
    let currentChatId = chatId;
    let acceptedMessageId: string | null = options.retryId || null;
    let currentRequestId: string | null = null;
    let completed = false;
    let citations: { url: string; title: string }[] = [];

    if (options.optimisticUser) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setMessages(current => [...current, options.optimisticUser as Msg]);
    }

    const ensureAssistant = () => {
      if (assistantCreated) return;
      assistantCreated = true;
      setMessages(current => [...current, { id: assistantId, role: 'assistant', content: '', meta: {} }]);
    };

    const removeStreamingAssistant = () => {
      setMessages(current => current.filter(item => item.id !== assistantId));
    };

    try {
      const response = await streamRequest('/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          chat_id: chatId,
          retry_message_id: options.retryId || null,
          content: options.content,
          model_id: selectedModel,
          web_search: webSearch,
          attachment_ids: options.attachmentIds,
          project_id: temporaryMode ? null : activeProject?.id || null,
          temporary: temporaryMode,
        }),
      });
      if (!isCurrentView()) return;

      acceptedMessageId = response.headers.get('x-uvms-message-id') || acceptedMessageId;
      currentChatId = response.headers.get('x-uvms-chat-id') || currentChatId;
      currentRequestId = response.headers.get('x-uvms-request-id');
      if (currentChatId) setChatId(currentChatId);
      if (currentRequestId) {
        setActiveRequestId(currentRequestId);
        setGenerationStatus('thinking');
      }

      if (!response.ok) throw new Error(await responseMessage(response as unknown as Response, 'AI request failed'));

      await consumeSse(response as unknown as Response, async (frame: SseFrame) => {
        if (!isCurrentView()) return;
        const data = frame.data as any;
        if (frame.event === 'meta') {
          if (data?.chat_id) { currentChatId = data.chat_id; setChatId(data.chat_id); }
          if (data?.request_id) { currentRequestId = data.request_id; setActiveRequestId(data.request_id); }
          return;
        }
        if (frame.event === 'tool' && data?.tool === 'web_search') {
          const status = String(data.status || 'searching');
          setGenerationStatus(status === 'reading' ? 'reading' : 'searching');
          return;
        }
        if (frame.event === 'citation' && data?.citation) {
          citations = [...citations, data.citation];
          if (assistantCreated) {
            setMessages(current => current.map(item => item.id === assistantId ? {
              ...item,
              meta: { ...(item.meta || {}), web_search: true, citations },
            } : item));
          }
          return;
        }
        if (frame.event === 'delta') {
          const delta = String(data?.delta || '');
          if (!delta) return;
          ensureAssistant();
          setGenerationStatus('streaming');
          setMessages(current => current.map(item => item.id === assistantId ? {
            ...item,
            content: item.content + delta,
            meta: { ...(item.meta || {}), citations },
          } : item));
          return;
        }
        if (frame.event === 'error') {
          throw new Error(String(data?.message || 'AI service is temporarily unavailable.'));
        }
        if (frame.event === 'done') {
          completed = true;
          setGenerationStatus('syncing');
          if (data?.stopped && assistantCreated) {
            setMessages(current => current.map(item => item.id === assistantId ? {
              ...item,
              meta: { ...(item.meta || {}), stopped: true, citations: data?.citations || citations },
            } : item));
          }
        }
      });
      if (!completed) throw new Error('Connection closed before the response completed.');

      if (isCurrentView()) {
        setRetryMessageId(null);
        await loadCore();
        if (currentChatId) {
          try { await refreshChat(currentChatId, activeProject, viewEpoch); } catch { /* stream UI already has content */ }
        }
      }
    } catch (e) {
      if (!isCurrentView()) return;
      const stoppedLocally = controller.signal.aborted;
      if (!stoppedLocally) {
        removeStreamingAssistant();
        if (acceptedMessageId) setRetryMessageId(acceptedMessageId);
        setError(friendlyNetworkError(e, 'AI request failed.'));
      }
      if (currentChatId) {
        await new Promise(resolve => setTimeout(resolve, stoppedLocally ? 350 : 120));
        if (isCurrentView()) {
          try {
            const body = await refreshChat(currentChatId, activeProject, viewEpoch);
            if (body.messages?.some((message: Msg) => message.role === 'assistant' && message.meta?.request_id === currentRequestId)) {
              setRetryMessageId(null);
            }
          } catch { /* keep local state */ }
        }
      }
    } finally {
      if (generationController.current === controller) generationController.current = null;
      if (viewEpoch === chatViewEpoch.current) {
        setGenerating(false);
        setActiveRequestId(null);
        setGenerationStatus('idle');
      }
    }
  }

  async function send() {
    const content = input.trim();
    if (!content && !pendingFiles.length && !pendingAssets.length) return;
    if (pendingFiles.length + pendingAssets.length > MAX_ATTACHMENTS) {
      setError('A chat can include up to 8 attachments. Remove one before sending.');
      return;
    }
    if (busy || generating || uploading || submissionLock.current || generationController.current) return;
    const submission = Symbol('send');
    const viewEpoch = chatViewEpoch.current;
    submissionLock.current = submission;
    try {
      if (imageMode) { await generateImage(); return; }
      haptic();

      const selected = [...pendingFiles];
      const reused = [...pendingAssets];
      setInput('');
      setPendingFiles([]);
      setPendingAssets([]);
      try {
        const uploaded = selected.length ? await uploadPicked(selected) : [];
        if (viewEpoch !== chatViewEpoch.current) return;
        const allAssets = [...reused, ...uploaded];
        const optimisticUser: Msg = {
          id: `u-${Date.now()}`,
          role: 'user',
          content,
          attachments: allAssets,
        };
        await streamPrompt({
          content,
          attachmentIds: allAssets.map(item => item.id),
          optimisticUser,
        });
      } catch (e) {
        if (viewEpoch === chatViewEpoch.current) {
          setInput(content);
          setPendingFiles(selected);
          setPendingAssets(reused);
          setError(friendlyNetworkError(e, 'Request failed'));
        }
      }
    } finally {
      if (submissionLock.current === submission) submissionLock.current = null;
    }
  }

  async function retryLastPrompt() {
    if (!retryMessageId || generating || submissionLock.current || generationController.current) return;
    await streamPrompt({ content: '', attachmentIds: [], retryId: retryMessageId, optimisticUser: null });
  }

  async function regenerateMessage(message: Msg) {
    if (!chatId || generating || busy || message.role !== 'assistant' || message.id.startsWith('a-stream-')) return;
    const viewEpoch = chatViewEpoch.current;
    setBusy(true);
    setError('');
    haptic();
    try {
      const response = await request(`/chats/${chatId}/messages/${message.id}/regenerate`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ model_id: selectedModel }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Could not regenerate response'));
      if (viewEpoch !== chatViewEpoch.current) return;
      await loadCore();
      await refreshChat(chatId, activeProject, viewEpoch);
    } catch (e) {
      if (viewEpoch === chatViewEpoch.current) setError(friendlyNetworkError(e, 'Could not regenerate response'));
    } finally {
      if (viewEpoch === chatViewEpoch.current) setBusy(false);
    }
  }

  async function stopGeneration() {
    const controller = generationController.current;
    if (!controller || controller.signal.aborted) return;
    setGenerationStatus('stopping');
    if (activeRequestId) {
      void request(`/chat/cancel/${activeRequestId}`, { method: 'POST', headers: authOnly() })
        .catch(() => undefined);
    }
    controller.abort();
  }

  async function generateImage() {
    const prompt = input.trim();
    if (!prompt || busy || generating || imageController.current) return;
    if (!imagesAvailable) { setError('Image generation is currently unavailable.'); return; }
    if (pendingFiles.length || pendingAssets.length) { setError('Remove attachments before using Image mode.'); return; }
    const controller = new AbortController();
    const viewEpoch = chatViewEpoch.current;
    imageController.current = controller;
    setBusy(true);
    setError('');
    setInput('');
    try {
      const response = await request('/images/generate', {
        method: 'POST',
        headers: headers(),
        signal: controller.signal,
        body: JSON.stringify({ chat_id: chatId, prompt, project_id: temporaryMode ? null : activeProject?.id || null, temporary: temporaryMode, size: '1024x1024', quality: 'medium' }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Image generation failed'));
      const body = await response.json();
      if (viewEpoch !== chatViewEpoch.current || imageController.current !== controller) return;
      setChatId(body.chat_id);
      await loadCore();
      await refreshChat(body.chat_id, activeProject, viewEpoch);
    } catch (e) {
      if (viewEpoch === chatViewEpoch.current && !controller.signal.aborted) {
        setInput(prompt);
        setError(friendlyNetworkError(e, 'Image generation failed'));
      }
    } finally {
      if (imageController.current === controller) imageController.current = null;
      if (viewEpoch === chatViewEpoch.current) setBusy(false);
    }
  }

  async function createProject() {
    const project = projectName.trim();
    if (!project || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await request('/projects', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ name: project, description: '', instructions: '' }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Project creation failed'));
      const body: Project = await response.json();
      setProjectName('');
      await loadCore();
      await loadProjectDetail(body);
    } catch (e) {
      setError(friendlyNetworkError(e, 'Project creation failed'));
    } finally {
      setBusy(false);
    }
  }

  async function saveProject() {
    if (!activeProject || !projectName.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await request(`/projects/${activeProject.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
          name: projectName.trim(),
          description: projectDescription.trim(),
          instructions: projectInstructions.trim(),
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Project update failed'));
      const updated: Project = await response.json();
      setActiveProject(updated);
      await loadCore();
      Alert.alert('Project saved', 'Instructions and project details are synced with Web.');
    } catch (e) {
      setError(friendlyNetworkError(e, 'Project update failed'));
    } finally {
      setBusy(false);
    }
  }

  async function addProjectFiles() {
    if (!activeProject || busy) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      const picked: PickedFile[] = result.assets.map(asset => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType || 'application/octet-stream',
        size: asset.size,
      }));
      await uploadPicked(picked.slice(0, 8), activeProject);
      await refreshProjectContents(activeProject);
      await loadLibrary();
    } catch (e) {
      setError(friendlyNetworkError(e, 'Project file upload failed'));
    }
  }

  function confirmDeleteProject() {
    if (!activeProject) return;
    const project = activeProject;
    Alert.alert('Delete project?', 'Project links will be removed. Your account files and chats remain according to server rules.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          const response = await request(`/projects/${project.id}`, { method: 'DELETE', headers: authOnly() });
          if (!response.ok) throw new Error(await responseMessage(response, 'Project deletion failed'));
          projectViewEpoch.current += 1;
          setActiveProject(null);
          setProjectName('');
          setProjectDescription('');
          setProjectInstructions('');
          setProjectFiles([]);
          setProjectChats([]);
          setProjects(rows => rows.filter(row => row.id !== project.id));
          await loadCore();
          setScreen('projects');
        } catch (e) { setError(friendlyNetworkError(e, 'Project deletion failed')); }
      } },
    ]);
  }

  async function createMemory() {
    const content = memoryDraft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await request('/memory', { method: 'POST', headers: headers(), body: JSON.stringify({ content }) });
      if (!response.ok) throw new Error(await responseMessage(response, 'Memory save failed'));
      const body = await response.json();
      setMemoryDraft('');
      setMemory(current => [body, ...current]);
    } catch (e) {
      setError(friendlyNetworkError(e, 'Memory save failed'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleMemory(item: Memory) {
    try {
      const response = await request(`/memory/${item.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ is_enabled: !item.is_enabled }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Memory update failed'));
      const body = await response.json();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setMemory(rows => rows.map(row => row.id === item.id ? body : row));
    } catch (e) { setError(friendlyNetworkError(e, 'Memory update failed')); }
  }

  async function deleteMemory(item: Memory) {
    try {
      const response = await request(`/memory/${item.id}`, { method: 'DELETE', headers: headers() });
      if (!response.ok) throw new Error(await responseMessage(response, 'Memory deletion failed'));
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setMemory(rows => rows.filter(row => row.id !== item.id));
    } catch (e) { setError(friendlyNetworkError(e, 'Memory deletion failed')); }
  }

  function useLibraryFile(file: FileAsset) {
    if (libraryOpenedFromChat) {
      if (!pendingAssets.some(row => row.id === file.id) && pendingFiles.length + pendingAssets.length >= MAX_ATTACHMENTS) {
        setError('A chat can include up to 8 attachments. Remove one before adding another.');
        return;
      }
      setLibraryOpenedFromChat(false);
      setPendingAssets(rows => [...rows.filter(row => row.id !== file.id), file].slice(0, MAX_ATTACHMENTS - pendingFiles.length));
      setImageMode(false);
      setScreen('chat');
      return;
    }
    newChat(screen === 'projectDetail' ? activeProject : null);
    setPendingAssets([file]);
    setImageMode(false);
  }

  function confirmDeleteLibraryFile(file: FileAsset) {
    Alert.alert('Delete file?', file.original_name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          const response = await request(`/files/${file.id}`, { method: 'DELETE', headers: authOnly() });
          if (!response.ok) throw new Error(await responseMessage(response, 'File deletion failed'));
          setLibraryFiles(rows => rows.filter(row => row.id !== file.id));
          setPendingAssets(rows => rows.filter(row => row.id !== file.id));
          if (previewFile?.id === file.id) setPreviewFile(null);
        } catch (e) { setError(friendlyNetworkError(e, 'File deletion failed')); }
      } },
    ]);
  }

  async function startCheckout(plan: Plan) {
    if (busy || !billingEnabled || plan.code === 'free' || plan.code === subscription?.plan_code) return;
    setBusy(true);
    setError('');
    setCheckout(null);
    try {
      const response = await request('/billing/checkout', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ plan_code: plan.code }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Checkout could not be created'));
      const body = await response.json();
      setCheckout(body);
      if (body.provider !== 'demo' && body.checkout_url) await Linking.openURL(body.checkout_url);
    } catch (e) {
      setError(friendlyNetworkError(e, 'Checkout failed'));
    } finally {
      setBusy(false);
    }
  }

  async function completeDemoCheckout() {
    if (!checkout || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await request(`/billing/demo/complete/${checkout.id}`, { method: 'POST', headers: headers() });
      if (!response.ok) throw new Error(await responseMessage(response, 'Demo payment failed'));
      setCheckout(await response.json());
      await loadCore();
    } catch (e) {
      setError(friendlyNetworkError(e, 'Demo payment failed'));
    } finally {
      setBusy(false);
    }
  }

  async function loadAccount() {
    if (!session) return;
    const epoch = authEpoch.current;
    try {
      const response = await request('/me/sessions', { headers: headers() });
      if (response.ok) {
        const rows = await response.json();
        if (epoch === authEpoch.current) setDeviceSessions(rows);
      }
    } catch { /* keep last known sessions */ }
  }

  async function saveProfile() {
    if (!session || !displayName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const response = await request('/me', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ display_name: displayName.trim() }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Profile update failed'));
      const user = await response.json();
      const next = { ...session, user };
      await writeStoredSession(next);
      setSession(next);
      Alert.alert('Profile updated', 'Your name is synced across Web and Mobile.');
    } catch (e) {
      setError(friendlyNetworkError(e, 'Profile update failed'));
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    if (!session || currentPassword.length < 8 || newPassword.length < 8) {
      setError('Both passwords must contain at least 8 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await request('/me/password', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Password update failed'));
      Alert.alert('Password updated', 'All signed-in sessions were revoked. Please sign in again.');
      clearPrivateState();
      await writeStoredSession(null);
    } catch (e) {
      setError(friendlyNetworkError(e, 'Password update failed'));
    } finally {
      setBusy(false);
    }
  }

  async function revokeDevice(id: string) {
    try {
      const response = await request(`/me/sessions/${id}`, { method: 'DELETE', headers: authOnly() });
      if (!response.ok) throw new Error(await responseMessage(response, 'Could not revoke session'));
      await loadAccount();
    } catch (e) { setError(friendlyNetworkError(e, 'Could not revoke session')); }
  }

  async function logoutAll() {
    if (!session) return;
    try {
      const response = await request('/me/logout-all', { method: 'POST', headers: authOnly() });
      if (!response.ok) throw new Error(await responseMessage(response, 'Could not sign out all devices'));
      clearPrivateState();
      await writeStoredSession(null);
    } catch (e) { setError(friendlyNetworkError(e, 'Could not sign out all devices')); }
  }

  function confirmDeleteAccount() {
    Alert.alert('Delete account?', 'This permanently deletes your UVMS AI account and stored data.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          const response = await request('/me', { method: 'DELETE', headers: authOnly() });
          if (!response.ok) throw new Error(await responseMessage(response, 'Account deletion failed'));
          clearPrivateState();
          await writeStoredSession(null);
        } catch (e) { setError(friendlyNetworkError(e, 'Account deletion failed')); }
      } },
    ]);
  }

  async function logout() {
    const current = session;
    clearPrivateState();
    await writeStoredSession(null);
    if (current?.refresh) {
      try {
        await fetch(`${API}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: current.refresh }),
        });
      } catch { /* local sign-out still proceeds */ }
    }
  }

  function retryCurrentView() {
    setError('');
    if (!session) return;
    if (screen === 'library') loadLibrary();
    else if (screen === 'account') loadAccount();
    else if (screen === 'projectDetail' && activeProject) loadProjectDetail(activeProject);
    else loadCore();
  }

  const title = useMemo(() => activeChatInfo?.title || activeProject?.name || (temporaryMode ? 'Temporary chat' : 'UVMS AI'), [activeChatInfo, activeProject, temporaryMode]);
  const generationLabel = generationStatus === 'searching' ? 'Searching…'
    : generationStatus === 'reading' ? 'Reading sources…'
      : generationStatus === 'streaming' ? 'Responding…'
        : generationStatus === 'syncing' ? 'Saving…'
        : generationStatus === 'stopping' ? 'Stopping…'
          : 'Thinking…';

  const renderMessage = useCallback(({ item }: { item: Msg }) => (
    <Pressable
      style={({ pressed }) => [s.bubble, item.role === 'user' ? s.userBubble : s.aiBubble, pressed && s.messagePressed]}
      onLongPress={() => { haptic(12); setMessageMenu(item); }}
      delayLongPress={320}
    >
      {item.role === 'assistant' && <Image source={require('./assets/uvms-logo.png')} style={s.bubbleLogo}/>} 
      <View style={{ flex: 1 }}>
        <RichMessage text={item.content}/>
        {item.meta?.stopped && <Text style={s.stoppedBadge}>STOPPED</Text>}
        {item.attachments?.map(file => file.category === 'image'
          ? <Pressable key={file.id} onPress={() => setPreviewFile(file)}><Image source={{ uri: `${API}/files/${file.id}/download`, headers: authOnly() }} style={s.generatedImage} resizeMode="contain"/></Pressable>
          : <View key={file.id} style={s.mobileAttachment}><Text style={s.mobileAttachmentIcon}>▧</Text><View style={{ flex: 1 }}><Text numberOfLines={1} style={s.mobileAttachmentName}>{file.original_name}</Text><Text style={s.mobileAttachmentMeta}>{formatBytes(file.size_bytes)}</Text></View></View>
        )}
        {item.meta?.citations?.length ? <View style={s.sources}><Text style={s.sourcesTitle}>SOURCES</Text>{item.meta.citations.map((citation, index) => <Pressable key={`${citation.url}-${index}`} style={s.sourceRow} onPress={() => Linking.openURL(citation.url)}><Text style={s.sourceNumber}>{index + 1}</Text><Text numberOfLines={1} style={s.sourceText}>{citation.title || citation.url}</Text></Pressable>)}</View> : null}
        {item.role === 'assistant' && item.content ? <View style={s.messageActions}><Pressable onPress={() => Share.share({ message: item.content })}><Text style={s.messageActionText}>Share</Text></Pressable><Pressable onPress={() => setMessageMenu(item)}><Text style={s.messageActionText}>More</Text></Pressable></View> : null}
      </View>
    </Pressable>
  ), [authOnly]);

  if (!ready) return <View style={s.center}><ActivityIndicator color="#29D196"/></View>;

  if (API_CONFIGURATION_MISSING) return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light"/>
      <View style={s.auth}>
        <Image source={require('./assets/uvms-logo.png')} style={s.logo}/>
        <Text style={s.title}>Server address missing</Text>
        <Text style={s.devWarningText}>Set EXPO_PUBLIC_API_URL to your UVMS AI server address and rebuild the app.</Text>
      </View>
    </SafeAreaView>
  );

  if (!session) return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light"/>
      <View style={s.auth}>
        <Image source={require('./assets/uvms-logo.png')} style={s.logo}/>
        <Text style={s.brand}>UVMS <Text style={s.ai}>AI</Text></Text>
        <Text style={s.tag}>WEB + MOBILE · ONE ACCOUNT</Text>
        {__DEV__ && LOOPBACK_API && Platform.OS !== 'web' ? <View style={s.devWarning}><Text style={s.devWarningTitle}>Physical phone setup required</Text><Text style={s.devWarningText}>EXPO_PUBLIC_API_URL still points to localhost. Use your PC LAN IP, for example http://192.168.1.50:8000/api/v1.</Text></View> : null}
        <Text style={s.title}>{register ? 'Create account' : 'Welcome back'}</Text>
        {register && <TextInput style={s.input} placeholder="Name" placeholderTextColor="#60736C" value={name} onChangeText={setName}/>} 
        <TextInput style={s.input} placeholder="Email" placeholderTextColor="#60736C" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail}/>
        <TextInput style={s.input} placeholder="Password" placeholderTextColor="#60736C" secureTextEntry value={password} onChangeText={setPassword}/>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Pressable style={({ pressed }) => [s.primary, pressed && s.pressed]} onPress={auth} disabled={busy}><Text style={s.primaryText}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</Text></Pressable>
        <Pressable onPress={() => setRegister(!register)}><Text style={s.link}>{register ? 'Already have an account? Sign in' : 'New here? Create account'}</Text></Pressable>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light"/>
      {screen !== 'chat' && <View style={s.header}>
        <View style={s.brandRow}><Image source={require('./assets/uvms-logo.png')} style={s.headerLogo}/><Text style={s.headerBrand}>UVMS <Text style={s.ai}>AI</Text></Text><Text style={s.beta}>{usage?.plan?.toUpperCase() || 'BETA'}</Text></View>
        <View style={s.headerRight}><StatusDot online={online}/><Pressable onPress={() => { setScreen('account'); loadAccount(); }}><Text style={s.logout}>Account</Text></Pressable></View>
      </View>}

      {screen !== 'chat' && (aiMode === 'development' || aiMode === 'demo') && <View style={[s.developmentBar, aiMode === 'demo' && s.demoBar]}><Text style={s.developmentText}>{aiMode === 'development' ? `${providerName === 'openrouter' ? 'OpenRouter' : 'Development'} text AI connected · Search off · Image/voice may be demo` : 'Text AI is in demo mode. Configure a backend provider for live answers.'}</Text></View>}
      {error ? <View style={s.errorBar}><Text style={s.errorBarText}>{error}</Text><Pressable onPress={retryCurrentView}><Text style={s.retryMini}>Retry</Text></Pressable><Pressable onPress={() => setError('')}><Text style={s.errorClose}>×</Text></Pressable></View> : null}

      <Animated.View style={{ flex: 1, opacity: screenOpacity }}>
        {screen === 'home' && <ScrollView contentContainerStyle={s.home}>
          <Image source={require('./assets/uvms-logo.png')} style={s.heroLogo}/>
          <Text style={s.hero}>Your AI. <Text style={s.ai}>Everywhere.</Text></Text>
          <Text style={s.sub}>Same account, chats, files, projects and memory as Web.</Text>
          <View style={s.quickGrid}>
            <Pressable style={({ pressed }) => [s.quick, pressed && s.pressed]} onPress={() => newChat(null)}><Text style={s.quickIcon}>＋</Text><Text style={s.quickTitle}>New chat</Text></Pressable>
            <Pressable style={({ pressed }) => [s.quick, pressed && s.pressed]} onPress={() => newChat(null, true)}><Text style={s.quickIcon}>◷</Text><Text style={s.quickTitle}>Temporary</Text></Pressable>
            <Pressable style={({ pressed }) => [s.quick, (!searchAvailable || aiMode === 'development') && s.quickDisabled, pressed && s.pressed]} disabled={!searchAvailable || aiMode === 'development'} onPress={() => { newChat(null); setWebSearch(true); }}><Text style={s.quickIcon}>◎</Text><Text style={s.quickTitle}>Web search</Text></Pressable>
            <Pressable style={({ pressed }) => [s.quick, !imagesAvailable && s.quickDisabled, pressed && s.pressed]} disabled={!imagesAvailable} onPress={() => { newChat(null); setImageMode(true); }}><Text style={s.quickIcon}>▣</Text><Text style={s.quickTitle}>Create image</Text></Pressable>
          </View>
          <Pressable style={s.usageCard} onPress={() => setScreen('plans')}><Text style={s.usageLabel}>{usage?.plan_name || 'Free'} PLAN</Text><Text style={s.usageValue}>{usage?.today?.messages ?? 0} messages today · {usage?.month?.images ?? 0} images this month · Tap to manage</Text></Pressable>
          <Pressable style={s.libraryShortcut} onPress={() => { setLibraryOpenedFromChat(false); setScreen('library'); loadLibrary(); }}><View><Text style={s.usageLabel}>LIBRARY</Text><Text style={s.usageValue}>Your uploaded files across Web + Mobile</Text></View><Text style={s.chev}>›</Text></Pressable>
          <Pressable style={s.libraryShortcut} onPress={() => { setScreen('shares'); loadShares(); }}><View><Text style={s.usageLabel}>SHARED LINKS</Text><Text style={s.usageValue}>Review and revoke public conversation snapshots</Text></View><Text style={s.chev}>›</Text></Pressable>
          <Text style={s.section}>RECENT CHATS · LONG-PRESS TO PIN</Text>
          {chats.map(chat => <Pressable key={chat.id} style={({ pressed }) => [s.chatRow, pressed && s.rowPressed]} onPress={() => openChat(chat.id)} onLongPress={() => togglePin(chat)}><Text style={s.chatTitle} numberOfLines={1}>{chat.is_pinned ? '⌖ ' : ''}{chat.title}</Text><Text style={s.chev}>›</Text></Pressable>)}
          {!chats.length && <Text style={s.empty}>No conversations yet.</Text>}
        </ScrollView>}

        {screen === 'chat' && <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
          <View style={s.chatTop}>
            <Pressable style={({ pressed }) => [s.headerIconButton, pressed && s.pressed]} onPress={() => setScreen(activeProject ? 'projectDetail' : 'home')} accessibilityLabel="Back"><Text style={s.headerIcon}>‹</Text></Pressable>
            <View style={s.chatTitleWrap}><Text style={s.chatTopTitle} numberOfLines={1}>{title}</Text><View style={s.chatMetaRow}><StatusDot online={online}/><Text style={[s.providerPillText, aiMode && !textLive && s.providerPillDemo]}>{textLive ? 'Public Beta' : aiMode ? 'Demo AI' : 'Connecting…'}</Text>{temporaryMode ? <Text style={s.tempContext}>TEMP</Text> : activeProject ? <Text style={s.projectContext}>PROJECT</Text> : null}</View></View>
            <Pressable style={({ pressed }) => [s.modelButton, pressed && s.pressed]} onPress={() => setModelPickerOpen(true)} accessibilityLabel="Choose model"><Text style={s.model} numberOfLines={1}>{(models.find(item => item.id === selectedModel)?.name || selectedModel).replace('UVMS-1 ', '')}</Text><Text style={s.modelArrow}>⌄</Text></Pressable>
            <Pressable style={({ pressed }) => [s.headerIconButton, pressed && s.pressed]} onPress={() => setChatMenuOpen(true)} accessibilityLabel="Conversation actions"><Text style={s.moreGlyph}>•••</Text></Pressable>
          </View>

          <FlatList
            ref={threadRef}
            style={s.thread}
            contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 18, gap: 10, paddingBottom: 22 }}
            data={messages}
            keyExtractor={item => item.id}
            renderItem={renderMessage}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => { if (userNearBottom.current) threadRef.current?.scrollToEnd({ animated: true }); }}
            onScroll={({ nativeEvent }) => {
              const distance = nativeEvent.contentSize.height - (nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height);
              userNearBottom.current = distance < 140;
            }}
            scrollEventThrottle={100}
            ListEmptyComponent={<View style={s.mobileWelcome}><Text style={s.managerEyebrow}>UVMS AI</Text><Text style={s.managerTitle}>What are we working on?</Text><Text style={s.sub}>{activeProject ? `This chat uses ${activeProject.name} instructions, files and context.` : 'Ask anything, attach a file, take a photo or use your Library.'}</Text></View>}
            ListFooterComponent={generating ? <View style={s.liveStatus}><ActivityIndicator size="small" color="#75D7AE"/><Text style={s.liveStatusText}>{generationLabel}</Text></View> : retryMessageId ? <Pressable style={s.retryCard} onPress={retryLastPrompt}><Text style={s.retryCardTitle}>Response failed</Text><Text style={s.retryCardText}>Your message is saved. Tap to retry without sending it twice.</Text></Pressable> : null}
          />

          {(pendingFiles.length > 0 || pendingAssets.length > 0) && <ScrollView horizontal style={s.pendingStrip} contentContainerStyle={{ gap: 7 }} showsHorizontalScrollIndicator={false}>
            {pendingAssets.map(file => <View key={`asset-${file.id}`} style={s.pendingChip}><Text style={s.pendingName} numberOfLines={1}>▧ {file.original_name}</Text><Pressable onPress={() => setPendingAssets(rows => rows.filter(row => row.id !== file.id))}><Text style={s.pendingRemove}>×</Text></Pressable></View>)}
            {pendingFiles.map((file, index) => <View key={`${file.uri}-${index}`} style={s.pendingChip}><Text style={s.pendingName} numberOfLines={1}>{file.name}</Text><Pressable onPress={() => setPendingFiles(rows => rows.filter((_, i) => i !== index))}><Text style={s.pendingRemove}>×</Text></Pressable></View>)}
          </ScrollView>}

          {(webSearch || imageMode || recorderState.isRecording) && <View style={s.activeModeRow}>{webSearch && <View style={s.modePill}><Text style={s.modePillText}>◎ Search</Text><Pressable onPress={() => setWebSearch(false)}><Text style={s.modePillClose}>×</Text></Pressable></View>}{imageMode && <View style={s.modePill}><Text style={s.modePillText}>{imagesMode === 'demo' ? '▣ Image · demo' : '▣ Image'}</Text><Pressable onPress={() => setImageMode(false)}><Text style={s.modePillClose}>×</Text></Pressable></View>}{recorderState.isRecording && <View style={[s.modePill,s.recordingPill]}><Text style={s.modePillText}>● Recording {formatDuration(recorderState.durationMillis)}</Text><Pressable onPress={cancelVoiceRecording}><Text style={s.modePillClose}>×</Text></Pressable></View>}</View>}

          <View style={s.composer}>
            <Pressable style={({ pressed }) => [s.plusButton, pressed && s.pressed]} onPress={() => { haptic(); setAttachmentSheetOpen(true); }} accessibilityLabel="Add attachment or tool"><Text style={s.plusGlyph}>＋</Text></Pressable>
            <TextInput style={s.messageInput} placeholder={imageMode ? 'Describe an image…' : (pendingFiles.length || pendingAssets.length) ? 'Ask about your files…' : 'Message UVMS AI…'} placeholderTextColor="#60736C" value={input} onChangeText={setInput} multiline maxLength={50000}/>
            {generating ? <Pressable style={({ pressed }) => [s.send, s.stopSend, pressed && s.pressed]} onPress={stopGeneration}><Text style={s.stopGlyph}>■</Text></Pressable>
              : <Pressable style={({ pressed }) => [s.send, (!input.trim() && !pendingFiles.length && !pendingAssets.length) && s.sendDisabled, pressed && s.pressed]} onPress={send} disabled={busy || uploading || (!input.trim() && !pendingFiles.length && !pendingAssets.length)}>{busy || uploading ? <ActivityIndicator size="small" color="#07110F"/> : <Text style={s.sendText}>↑</Text>}</Pressable>}
          </View>
        </KeyboardAvoidingView>}

        {screen === 'projects' && <ScrollView contentContainerStyle={s.manager}>
          <Text style={s.managerEyebrow}>PROJECTS</Text><Text style={s.managerTitle}>Keep work together.</Text><Text style={s.sub}>Project instructions, files and chats stay synced with Web.</Text>
          <View style={s.inlineComposer}><TextInput style={s.managerInput} placeholder="New project name" placeholderTextColor="#60736C" value={projectName} onChangeText={setProjectName}/><Pressable style={s.addButton} onPress={createProject}><Text style={s.addButtonText}>＋</Text></Pressable></View>
          {projects.map(project => <Pressable key={project.id} style={({ pressed }) => [s.managerCard, pressed && s.rowPressed]} onPress={() => loadProjectDetail(project)}><View style={{ flex: 1 }}><Text style={s.managerCardTitle}>{project.name}</Text><Text style={s.managerCardText} numberOfLines={2}>{project.description || (project.instructions ? 'Custom instructions enabled' : 'No description yet')}</Text></View><Text style={s.chev}>›</Text></Pressable>)}
          {!projects.length && <Text style={s.empty}>No projects yet.</Text>}
        </ScrollView>}

        {screen === 'projectDetail' && activeProject && <ScrollView contentContainerStyle={s.manager} keyboardShouldPersistTaps="handled">
          <View style={s.detailHeader}><Pressable onPress={() => { projectViewEpoch.current += 1; setActiveProject(null); setProjectName(''); setProjectDescription(''); setProjectInstructions(''); setScreen('projects'); }}><Text style={s.back}>‹ Projects</Text></Pressable><Text style={s.detailBadge}>PROJECT</Text></View>
          <Text style={s.managerTitle}>{activeProject.name}</Text>
          <View style={s.accountCard}><Text style={s.usageLabel}>PROJECT DETAILS</Text><TextInput style={s.managerInput} value={projectName} onChangeText={setProjectName} placeholder="Project name" placeholderTextColor="#60736C"/><TextInput style={[s.managerInput, s.multilineInput]} value={projectDescription} onChangeText={setProjectDescription} placeholder="Description" placeholderTextColor="#60736C" multiline/><TextInput style={[s.managerInput, s.instructionsInput]} value={projectInstructions} onChangeText={setProjectInstructions} placeholder="Instructions used by AI in project chats" placeholderTextColor="#60736C" multiline/><Pressable style={s.memorySave} onPress={saveProject} disabled={busy}><Text style={s.memorySaveText}>Save project</Text></Pressable></View>
          <View style={s.projectActionRow}><Pressable style={s.projectAction} onPress={() => newChat(activeProject)}><Text style={s.projectActionIcon}>＋</Text><Text style={s.projectActionText}>New chat</Text></Pressable><Pressable style={s.projectAction} onPress={addProjectFiles}><Text style={s.projectActionIcon}>▧</Text><Text style={s.projectActionText}>Add files</Text></Pressable></View>
          <Text style={s.section}>PROJECT FILES</Text>
          {projectFiles.map(file => <View key={file.id} style={s.fileRow}><Text style={s.fileIcon}>{file.category === 'image' ? '▣' : '▧'}</Text><View style={{ flex: 1 }}><Text style={s.fileTitle} numberOfLines={1}>{file.original_name}</Text><Text style={s.fileMeta}>{formatBytes(file.size_bytes)} · {file.mime_type}</Text></View><Pressable onPress={() => useLibraryFile(file)}><Text style={s.memoryAction}>Use</Text></Pressable></View>)}
          {!projectFiles.length && <Text style={s.empty}>No project files yet.</Text>}
          <Text style={s.section}>PROJECT CHATS</Text>
          {projectChats.map(chat => <Pressable key={chat.id} style={s.chatRow} onPress={() => openChat(chat.id, activeProject)}><Text style={s.chatTitle} numberOfLines={1}>{chat.title}</Text><Text style={s.chev}>›</Text></Pressable>)}
          {!projectChats.length && <Text style={s.empty}>No project chats yet.</Text>}
          <Pressable style={[s.deleteMobile, { marginTop: 28 }]} onPress={confirmDeleteProject}><Text style={s.deleteMobileText}>Delete project</Text></Pressable>
        </ScrollView>}

        {screen === 'memory' && <ScrollView contentContainerStyle={s.manager}>
          <Text style={s.managerEyebrow}>MEMORY</Text><Text style={s.managerTitle}>Context that follows you.</Text><Text style={s.sub}>Enabled memories can be used in relevant conversations on Web and Mobile.</Text>
          <View style={s.memoryComposer}><TextInput style={s.memoryInput} placeholder="Something UVMS AI should remember…" placeholderTextColor="#60736C" value={memoryDraft} onChangeText={setMemoryDraft} multiline/><Pressable style={s.memorySave} onPress={createMemory}><Text style={s.memorySaveText}>Save</Text></Pressable></View>
          {memory.map(item => <View key={item.id} style={[s.memoryCard, !item.is_enabled && s.memoryDisabled]}><View style={s.memoryHeader}><Text style={[s.memoryState, item.is_enabled ? s.memoryOn : s.memoryOff]}>{item.is_enabled ? 'ENABLED' : 'DISABLED'}</Text></View><Text style={s.memoryText}>{item.content}</Text><View style={s.memoryActions}><Pressable onPress={() => toggleMemory(item)}><Text style={s.memoryAction}>{item.is_enabled ? 'Disable' : 'Enable'}</Text></Pressable><Pressable onPress={() => deleteMemory(item)}><Text style={[s.memoryAction, s.danger]}>Delete</Text></Pressable></View></View>)}
          {!memory.length && <Text style={s.empty}>No saved memory yet.</Text>}
        </ScrollView>}

        {screen === 'library' && <ScrollView contentContainerStyle={s.manager}>
          {libraryOpenedFromChat && <Pressable onPress={() => { setLibraryOpenedFromChat(false); setScreen('chat'); }}><Text style={s.back}>‹ Back to chat</Text></Pressable>}
          <Text style={s.managerEyebrow}>LIBRARY</Text><Text style={s.managerTitle}>Files, everywhere.</Text><Text style={s.sub}>Files uploaded on Web or Mobile can be reused in a conversation.</Text>
          <Pressable style={s.secondaryMobile} onPress={loadLibrary}><Text style={s.secondaryMobileText}>{libraryLoading ? 'Refreshing…' : 'Refresh Library'}</Text></Pressable>
          {libraryLoading && !libraryFiles.length ? <ActivityIndicator color="#75D7AE" style={{ marginTop: 24 }}/> : null}
          {libraryFiles.map(file => <View key={file.id} style={s.libraryCard}>{file.category === 'image' ? <Pressable onPress={() => setPreviewFile(file)}><Image source={{ uri: `${API}/files/${file.id}/download`, headers: authOnly() }} style={s.libraryThumb}/></Pressable> : <View style={s.libraryFileIcon}><Text style={s.fileIcon}>▧</Text></View>}<View style={{ flex: 1 }}><Text style={s.managerCardTitle} numberOfLines={1}>{file.original_name}</Text><Text style={s.managerCardText}>{formatBytes(file.size_bytes)} · {file.category}</Text><View style={s.libraryActions}><Pressable onPress={() => useLibraryFile(file)}><Text style={s.memoryAction}>Use in chat</Text></Pressable>{file.category === 'image' && <Pressable onPress={() => setPreviewFile(file)}><Text style={s.memoryAction}>Preview</Text></Pressable>}<Pressable onPress={() => confirmDeleteLibraryFile(file)}><Text style={[s.memoryAction, s.danger]}>Delete</Text></Pressable></View></View></View>)}
          {!libraryLoading && !libraryFiles.length && <Text style={s.empty}>Library is empty.</Text>}
        </ScrollView>}

        {screen === 'shares' && <ScrollView contentContainerStyle={s.manager}>
          <Text style={s.managerEyebrow}>SHARED LINKS</Text><Text style={s.managerTitle}>Public snapshots.</Text><Text style={s.sub}>Shared conversations are immutable snapshots. The secret URL itself is not recoverable after creation; you can always revoke access here.</Text>
          <Pressable style={s.secondaryMobile} onPress={loadShares}><Text style={s.secondaryMobileText}>{sharesLoading ? 'Refreshing…' : 'Refresh shared links'}</Text></Pressable>
          {sharesLoading && !sharedLinks.length ? <ActivityIndicator color="#75D7AE" style={{ marginTop: 24 }}/> : null}
          {sharedLinks.map(item => { const inactive = Boolean(item.revoked_at) || (item.expires_at ? new Date(item.expires_at).getTime() <= Date.now() : false); return <View key={item.id} style={[s.shareManagerCard, inactive && s.shareManagerInactive]}><View style={{flex:1}}><View style={s.shareManagerTitleRow}><Text style={s.managerCardTitle} numberOfLines={1}>{item.title}</Text><Text style={[s.shareManagerStatus, inactive && s.shareManagerStatusOff]}>{item.revoked_at ? 'REVOKED' : inactive ? 'EXPIRED' : 'ACTIVE'}</Text></View><Text style={s.managerCardText}>Created {new Date(item.created_at).toLocaleString()}</Text>{item.source_chat_id && <Pressable onPress={() => openChat(item.source_chat_id!)}><Text style={s.memoryAction}>Open source chat</Text></Pressable>}</View>{!inactive && <Pressable onPress={() => confirmRevokeSharedLink(item)}><Text style={[s.memoryAction,s.danger]}>Revoke</Text></Pressable>}</View>})}
          {!sharesLoading && !sharedLinks.length && <Text style={s.empty}>No shared conversations yet.</Text>}
        </ScrollView>}

        {screen === 'plans' && <ScrollView contentContainerStyle={s.manager}>
          <Text style={s.managerEyebrow}>PLANS</Text><Text style={s.managerTitle}>One plan. Every device.</Text><Text style={s.sub}>Your UVMS subscription and limits come from the shared backend.</Text>
          <View style={s.currentPlanMobile}><Text style={s.usageLabel}>CURRENT</Text><Text style={s.currentPlanTitle}>{subscription?.plan_name || usage?.plan_name || 'Free'}</Text><Text style={s.managerCardText}>{subscription?.status || 'active'} · {usage?.today?.messages ?? 0} messages today</Text></View>
          {plans.map(plan => { const current = plan.code === subscription?.plan_code; return <View key={plan.code} style={[s.planCardMobile, current && s.planCardCurrent]}><View style={{ flex: 1 }}><Text style={s.managerEyebrow}>{plan.code.toUpperCase()}</Text><Text style={s.planNameMobile}>{plan.name}</Text><Text style={s.planPriceMobile}>{plan.monthly_price_cents === 0 ? 'Free' : `${plan.currency} ${(plan.monthly_price_cents/100).toFixed(2)} / month`}</Text><Text style={s.managerCardText}>{plan.limits.messages_daily ?? 0} msgs/day · {plan.limits.web_search_daily ?? 0} searches/day · {plan.limits.images_monthly ?? 0} images/month</Text></View><Pressable style={[s.openButton, (current || plan.code === 'free' || !billingEnabled) && s.planButtonDisabled]} disabled={busy || current || plan.code === 'free' || !billingEnabled} onPress={() => startCheckout(plan)}><Text style={s.openButtonText}>{current ? 'Current' : plan.code === 'free' ? 'Included' : !billingEnabled ? 'Coming soon' : 'Choose'}</Text></Pressable></View>})}
          {checkout && <View style={s.checkoutMobile}><Text style={s.managerEyebrow}>CHECKOUT · {checkout.provider.toUpperCase()}</Text><Text style={s.planNameMobile}>{checkout.plan_code.toUpperCase()} · {checkout.currency} {(checkout.amount_cents/100).toFixed(2)}</Text><Text style={s.managerCardText}>Status: {checkout.status}</Text>{checkout.provider === 'demo' && checkout.status === 'pending' && <Pressable style={s.memorySave} onPress={completeDemoCheckout}><Text style={s.memorySaveText}>{busy ? 'Processing…' : 'Complete demo payment'}</Text></Pressable>}{checkout.status === 'completed' && <Text style={s.checkoutDone}>✓ Activated on Web + Mobile</Text>}</View>}
        </ScrollView>}

        {screen === 'account' && <ScrollView contentContainerStyle={s.manager} keyboardShouldPersistTaps="handled">
          <Text style={s.managerEyebrow}>ACCOUNT</Text><Text style={s.managerTitle}>Security & profile.</Text><Text style={s.sub}>Your identity, sessions and plan are shared between Web and Mobile.</Text>
          <View style={s.accountCard}><Text style={s.usageLabel}>PROFILE</Text><TextInput style={s.managerInput} value={displayName} onChangeText={setDisplayName} placeholder="Display name" placeholderTextColor="#60736C"/><Text style={s.accountEmail}>{session.user.email}</Text><Pressable style={s.memorySave} onPress={saveProfile} disabled={busy}><Text style={s.memorySaveText}>Save profile</Text></Pressable></View>
          <View style={s.accountCard}><Text style={s.usageLabel}>PLAN & USAGE</Text><Text style={s.currentPlanTitle}>{subscription?.plan_name || usage?.plan_name || 'Free'}</Text><Text style={s.managerCardText}>{usage?.today?.messages ?? 0} messages today · {usage?.today?.web_searches ?? 0} searches today · {usage?.month?.images ?? 0} images this month</Text><Pressable style={s.secondaryMobile} onPress={() => setScreen('plans')}><Text style={s.secondaryMobileText}>Manage plan</Text></Pressable></View>
          <View style={s.accountCard}><Text style={s.usageLabel}>AI PREFERENCES</Text><Pressable style={s.modelPreference} onPress={() => setModelPickerOpen(true)}><View><Text style={s.managerCardTitle}>{models.find(item => item.id === selectedModel)?.name || selectedModel}</Text><Text style={s.managerCardText}>Default mobile model</Text></View><Text style={s.chev}>›</Text></Pressable><Pressable style={s.secondaryMobile} onPress={() => setScreen('memory')}><Text style={s.secondaryMobileText}>Manage memory</Text></Pressable><Pressable style={s.secondaryMobile} onPress={() => { setScreen('shares'); loadShares(); }}><Text style={s.secondaryMobileText}>Shared conversations</Text></Pressable></View>
          <View style={s.accountCard}><Text style={s.usageLabel}>PASSWORD</Text><TextInput style={s.managerInput} secureTextEntry value={currentPassword} onChangeText={setCurrentPassword} placeholder="Current password" placeholderTextColor="#60736C"/><TextInput style={s.managerInput} secureTextEntry value={newPassword} onChangeText={setNewPassword} placeholder="New password" placeholderTextColor="#60736C"/><Pressable style={s.memorySave} onPress={changePassword} disabled={busy}><Text style={s.memorySaveText}>Change password</Text></Pressable></View>
          <View style={s.accountCard}><Text style={s.usageLabel}>SIGNED-IN SESSIONS</Text>{deviceSessions.map(item => <View key={item.id} style={s.deviceRow}><View style={{flex:1}}><Text style={s.deviceTitle} numberOfLines={1}>{item.user_agent || 'Unknown device'}</Text><Text style={s.deviceMeta}>{item.ip_address || 'Unknown IP'} · {new Date(item.created_at).toLocaleDateString()}</Text></View>{!item.revoked_at && <Pressable onPress={() => revokeDevice(item.id)}><Text style={s.memoryAction}>Revoke</Text></Pressable>}</View>)}<Pressable style={s.secondaryMobile} onPress={logoutAll}><Text style={s.secondaryMobileText}>Sign out all devices</Text></Pressable></View>
          {__DEV__ && <View style={s.accountCard}><Text style={s.usageLabel}>DEVELOPMENT DIAGNOSTICS</Text><Text style={s.managerCardText}>API: {API}</Text><Text style={s.managerCardText}>Status: {online ? 'reachable' : 'offline / unreachable'}</Text>{LOOPBACK_API && Platform.OS !== 'web' && <Text style={s.warningText}>A physical phone cannot reach your PC through localhost. Start Expo with the PC LAN IP.</Text>}</View>}
          <View style={s.accountCard}><Text style={s.usageLabel}>ABOUT</Text><Text style={s.currentPlanTitle}>UVMS AI {appConfig.expo.version}</Text><Text style={s.managerCardText}>{textLive ? `${providerName === 'groq' ? 'Groq' : providerName === 'gemini' ? 'Gemini' : providerName === 'openrouter' ? 'OpenRouter' : providerName || 'Live'} text provider connected through the UVMS backend.` : 'Text AI is currently running in demo mode.'}</Text><Text style={s.managerCardText}>Web + Mobile · one account · UVMS</Text></View>
          <View style={s.accountCard}><Pressable style={s.secondaryMobile} onPress={logout}><Text style={s.secondaryMobileText}>Sign out this device</Text></Pressable><Pressable style={s.deleteMobile} onPress={confirmDeleteAccount}><Text style={s.deleteMobileText}>Delete account</Text></Pressable></View>
        </ScrollView>}
      </Animated.View>

      {screen !== 'chat' && screen !== 'projectDetail' && <View style={s.nav}>
        <Pressable style={s.navItem} onPress={() => setScreen('home')}><Text style={[s.navIcon, screen === 'home' && s.navActive]}>◉</Text><Text style={[s.navLabel, screen === 'home' && s.navActive]}>Chat</Text></Pressable>
        <Pressable style={s.navItem} onPress={() => setScreen('projects')}><Text style={[s.navIcon, screen === 'projects' && s.navActive]}>▱</Text><Text style={[s.navLabel, screen === 'projects' && s.navActive]}>Projects</Text></Pressable>
        <Pressable style={s.navItem} onPress={() => { setLibraryOpenedFromChat(false); setScreen('library'); loadLibrary(); }}><Text style={[s.navIcon, screen === 'library' && s.navActive]}>▧</Text><Text style={[s.navLabel, screen === 'library' && s.navActive]}>Library</Text></Pressable>
        <Pressable style={s.navItem} onPress={() => setScreen('memory')}><Text style={[s.navIcon, screen === 'memory' && s.navActive]}>◆</Text><Text style={[s.navLabel, screen === 'memory' && s.navActive]}>Memory</Text></Pressable>
        <Pressable style={s.navItem} onPress={() => { setScreen('account'); loadAccount(); }}><Text style={[s.navIcon, (screen === 'account' || screen === 'shares' || screen === 'plans') && s.navActive]}>●</Text><Text style={[s.navLabel, (screen === 'account' || screen === 'shares' || screen === 'plans') && s.navActive]}>Account</Text></Pressable>
      </View>}

      <Modal visible={modelPickerOpen} transparent animationType="fade" onRequestClose={() => setModelPickerOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setModelPickerOpen(false)}>
          <Pressable style={s.modelSheet} onPress={() => undefined}>
            <View style={s.sheetHandle}/><Text style={s.sheetTitle}>Choose model</Text><Text style={s.sheetSub}>Access is enforced by your server-side plan.</Text>
            {models.map(model => <Pressable key={model.id} style={[s.modelRow, model.id === selectedModel && s.modelRowActive, !model.available && s.modelRowLocked]} onPress={() => selectModel(model)}><View style={{ flex: 1 }}><Text style={s.modelRowTitle}>{model.name}</Text><Text style={s.modelRowDescription}>{model.description}</Text></View><Text style={model.available ? s.modelRowTier : s.modelRowLockedText}>{model.available ? model.tier.toUpperCase() : `${model.tier.toUpperCase()} REQUIRED`}</Text></Pressable>)}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={attachmentSheetOpen} transparent animationType="fade" onRequestClose={() => setAttachmentSheetOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setAttachmentSheetOpen(false)}>
          <Pressable style={s.modelSheet} onPress={() => undefined}>
            <View style={s.sheetHandle}/><Text style={s.sheetTitle}>Add to this chat</Text><Text style={s.sheetSub}>Files and photos are uploaded to your UVMS account and can be analyzed by the backend.</Text>
            <View style={s.actionGrid}>
              <Pressable style={({ pressed }) => [s.actionTile, !visionAvailable && s.actionTileDisabled, pressed && s.pressed]} onPress={() => { setAttachmentSheetOpen(false); void pickPhoto(false); }}><Text style={s.actionTileIcon}>▣</Text><Text style={s.actionTileTitle}>Photos</Text><Text style={s.actionTileMeta}>{visionAvailable ? 'Vision' : 'Vision unavailable (Beta)'}</Text></Pressable>
              <Pressable style={({ pressed }) => [s.actionTile, !visionAvailable && s.actionTileDisabled, pressed && s.pressed]} onPress={() => { setAttachmentSheetOpen(false); void pickPhoto(true); }}><Text style={s.actionTileIcon}>◉</Text><Text style={s.actionTileTitle}>Camera</Text><Text style={s.actionTileMeta}>{visionAvailable ? 'Take a photo' : 'Vision unavailable (Beta)'}</Text></Pressable>
              <Pressable style={({ pressed }) => [s.actionTile, pressed && s.pressed]} onPress={() => { setAttachmentSheetOpen(false); void pickDocuments(); }}><Text style={s.actionTileIcon}>▧</Text><Text style={s.actionTileTitle}>File</Text><Text style={s.actionTileMeta}>PDF, DOCX, XLSX…</Text></Pressable>
              <Pressable style={({ pressed }) => [s.actionTile, pressed && s.pressed]} onPress={() => { setAttachmentSheetOpen(false); setLibraryOpenedFromChat(true); setScreen('library'); void loadLibrary(); }}><Text style={s.actionTileIcon}>◇</Text><Text style={s.actionTileTitle}>Library</Text><Text style={s.actionTileMeta}>Reuse a file</Text></Pressable>
              <Pressable style={({ pressed }) => [s.actionTile, (!voiceAvailable || imageMode) && s.actionTileDisabled, pressed && s.pressed]} onPress={() => { if (!voiceAvailable) { Alert.alert('Voice unavailable', 'Voice transcription is not enabled on this server.'); return; } setAttachmentSheetOpen(false); void toggleVoiceRecording(); }}><Text style={s.actionTileIcon}>●</Text><Text style={s.actionTileTitle}>Voice</Text><Text style={s.actionTileMeta}>{voiceMode === 'demo' ? 'Demo transcription' : 'Dictate message'}</Text></Pressable>
              <Pressable style={({ pressed }) => [s.actionTile, (!searchAvailable || aiMode === 'development') && s.actionTileDisabled, pressed && s.pressed]} onPress={() => { if (!searchAvailable || aiMode === 'development') { Alert.alert('Search unavailable', 'Web search is disabled for the current development provider.'); return; } setAttachmentSheetOpen(false); setWebSearch(value => !value); setImageMode(false); }}><Text style={s.actionTileIcon}>◎</Text><Text style={s.actionTileTitle}>Search</Text><Text style={s.actionTileMeta}>{!searchAvailable || aiMode === 'development' ? 'Unavailable' : webSearch ? 'On' : 'Off'}</Text></Pressable>
              <Pressable style={({ pressed }) => [s.actionTile, !imagesAvailable && s.actionTileDisabled, pressed && s.pressed]} onPress={() => { if (!imagesAvailable) { Alert.alert('Image unavailable', 'Image generation is not enabled on this server.'); return; } setAttachmentSheetOpen(false); setImageMode(value => !value); setWebSearch(false); }}><Text style={s.actionTileIcon}>✦</Text><Text style={s.actionTileTitle}>Image</Text><Text style={s.actionTileMeta}>{imagesMode === 'demo' ? 'Demo generator' : imageMode ? 'On' : 'Generate'}</Text></Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={chatMenuOpen} transparent animationType="fade" onRequestClose={() => setChatMenuOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setChatMenuOpen(false)}>
          <Pressable style={s.compactSheet} onPress={() => undefined}>
            <View style={s.sheetHandle}/><Text style={s.sheetTitle}>Conversation</Text>
            {chatId ? <Pressable style={({ pressed }) => [s.sheetAction, pressed && s.pressed]} onPress={() => { setChatMenuOpen(false); void branchChat(); }}><Text style={s.sheetActionIcon}>⑂</Text><View style={{flex:1}}><Text style={s.sheetActionTitle}>Branch chat</Text><Text style={s.sheetActionMeta}>Create a separate copy of this conversation</Text></View></Pressable> : null}
            {chatId && !temporaryMode ? <Pressable style={({ pressed }) => [s.sheetAction, pressed && s.pressed]} onPress={() => { setChatMenuOpen(false); void shareConversation(); }}><Text style={s.sheetActionIcon}>↗</Text><View style={{flex:1}}><Text style={s.sheetActionTitle}>Share snapshot</Text><Text style={s.sheetActionMeta}>Create a read-only public snapshot</Text></View></Pressable> : null}
            <Pressable style={({ pressed }) => [s.sheetAction, pressed && s.pressed]} onPress={() => { setChatMenuOpen(false); newChat(activeProject, false); }}><Text style={s.sheetActionIcon}>＋</Text><View style={{flex:1}}><Text style={s.sheetActionTitle}>New chat</Text><Text style={s.sheetActionMeta}>Start a clean conversation</Text></View></Pressable>
            {temporaryMode ? <Pressable style={({ pressed }) => [s.sheetAction, pressed && s.pressed]} onPress={() => { setChatMenuOpen(false); newChat(null, false); }}><Text style={s.sheetActionIcon}>◷</Text><View style={{flex:1}}><Text style={s.sheetActionTitle}>Exit temporary chat</Text><Text style={s.sheetActionMeta}>Temporary chats do not use Memory or Project context</Text></View></Pressable> : null}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={Boolean(messageMenu)} transparent animationType="fade" onRequestClose={() => setMessageMenu(null)}>
        <Pressable style={s.modalBackdrop} onPress={() => setMessageMenu(null)}>
          <Pressable style={s.compactSheet} onPress={() => undefined}>
            <View style={s.sheetHandle}/><Text style={s.sheetTitle}>{messageMenu?.role === 'assistant' ? 'Response actions' : 'Message actions'}</Text><Text style={s.sheetSub}>Message text is selectable — long-press the text itself to copy a selection.</Text>
            {messageMenu?.content ? <Pressable style={({ pressed }) => [s.sheetAction, pressed && s.pressed]} onPress={() => { const content = messageMenu.content; setMessageMenu(null); void Share.share({ message: content }); }}><Text style={s.sheetActionIcon}>↗</Text><View style={{flex:1}}><Text style={s.sheetActionTitle}>Share text</Text><Text style={s.sheetActionMeta}>Use the native iOS / Android share sheet</Text></View></Pressable> : null}
            {messageMenu?.role === 'assistant' ? <Pressable style={({ pressed }) => [s.sheetAction, pressed && s.pressed]} onPress={() => { const item = messageMenu; setMessageMenu(null); if (item) void regenerateMessage(item); }}><Text style={s.sheetActionIcon}>↻</Text><View style={{flex:1}}><Text style={s.sheetActionTitle}>Regenerate</Text><Text style={s.sheetActionMeta}>Generate a fresh answer from the same point</Text></View></Pressable> : null}
            {messageMenu && chatId ? <Pressable style={({ pressed }) => [s.sheetAction, pressed && s.pressed]} onPress={() => { const id = messageMenu.id; setMessageMenu(null); void branchChat(id); }}><Text style={s.sheetActionIcon}>⑂</Text><View style={{flex:1}}><Text style={s.sheetActionTitle}>Branch from here</Text><Text style={s.sheetActionMeta}>Copy the conversation through this message</Text></View></Pressable> : null}
            {messageMenu?.role === 'user' && messageMenu.content ? <Pressable style={({ pressed }) => [s.sheetAction, pressed && s.pressed]} onPress={() => { setInput(messageMenu.content); setMessageMenu(null); }}><Text style={s.sheetActionIcon}>↙</Text><View style={{flex:1}}><Text style={s.sheetActionTitle}>Use as draft</Text><Text style={s.sheetActionMeta}>Put this text back into the composer</Text></View></Pressable> : null}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={Boolean(previewFile)} transparent animationType="fade" onRequestClose={() => setPreviewFile(null)}>
        <View style={s.previewBackdrop}><View style={s.previewHeader}><Text style={s.previewTitle} numberOfLines={1}>{previewFile?.original_name}</Text><Pressable onPress={() => setPreviewFile(null)}><Text style={s.previewClose}>×</Text></Pressable></View>{previewFile && <Image source={{ uri: `${API}/files/${previewFile.id}/download`, headers: authOnly() }} style={s.previewImage} resizeMode="contain"/>}</View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:{flex:1,backgroundColor:'#07110F'},
  center:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:'#07110F'},
  auth:{flex:1,padding:28,justifyContent:'center'},
  logo:{width:76,height:76,resizeMode:'contain',alignSelf:'center'},
  brand:{color:'#F5F9F7',fontSize:32,fontWeight:'900',textAlign:'center',marginTop:10},
  ai:{color:'#A5EB3D'},
  tag:{color:'#607970',fontSize:10,fontWeight:'800',letterSpacing:2,textAlign:'center',marginTop:5,marginBottom:24},
  title:{color:'#F5F9F7',fontSize:25,fontWeight:'800',marginBottom:14},
  input:{height:50,borderRadius:13,borderWidth:1,borderColor:'#20332E',backgroundColor:'#0C1714',paddingHorizontal:14,color:'#F5F9F7',marginBottom:10},
  primary:{height:50,borderRadius:13,backgroundColor:'#8FEA50',alignItems:'center',justifyContent:'center',marginTop:4},
  primaryText:{color:'#07110F',fontWeight:'900'},
  pressed:{opacity:.76,transform:[{scale:.985}]},
  link:{color:'#7F998F',fontSize:12,textAlign:'center',marginTop:18},
  error:{color:'#FF7B86',fontSize:11,marginVertical:4},
  devWarning:{borderWidth:1,borderColor:'#705D23',backgroundColor:'#211D0D',borderRadius:12,padding:11,marginBottom:20},
  devWarningTitle:{color:'#E9D178',fontSize:10,fontWeight:'900'},
  devWarningText:{color:'#A99E73',fontSize:9,lineHeight:14,marginTop:4},
  header:{height:60,paddingHorizontal:15,borderBottomWidth:1,borderBottomColor:'#1B2C27',flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#091310'},
  brandRow:{flexDirection:'row',alignItems:'center',gap:7},
  headerRight:{flexDirection:'row',alignItems:'center',gap:8},
  headerLogo:{width:28,height:28,resizeMode:'contain'},
  headerBrand:{color:'#EAF3EF',fontWeight:'900',fontSize:16},
  beta:{fontSize:8,fontWeight:'900',color:'#91CE56',borderWidth:1,borderColor:'#294933',borderRadius:8,paddingHorizontal:6,paddingVertical:3},
  logout:{fontSize:10,color:'#718A80'},
  statusDot:{width:7,height:7,borderRadius:4},statusOnline:{backgroundColor:'#6BDD8A'},statusOffline:{backgroundColor:'#D36C76'},
  developmentBar:{minHeight:36,backgroundColor:'#0B1D18',borderBottomWidth:1,borderBottomColor:'#1B372E',paddingHorizontal:14,justifyContent:'center'},
  demoBar:{backgroundColor:'#21180D',borderBottomColor:'#4D3A1C'},
  developmentText:{color:'#78A291',fontSize:10,textAlign:'center',fontWeight:'700'},
  errorBar:{minHeight:42,paddingHorizontal:14,backgroundColor:'#281317',borderBottomWidth:1,borderBottomColor:'#52232B',flexDirection:'row',alignItems:'center',gap:10},
  errorBarText:{color:'#E48C95',fontSize:10,flex:1},retryMini:{color:'#9EE4C4',fontSize:9,fontWeight:'900'},errorClose:{color:'#D8A0A5',fontSize:20},
  home:{padding:22,paddingBottom:110,alignItems:'center'},
  heroLogo:{width:64,height:64,resizeMode:'contain',marginTop:25},
  hero:{color:'#F5F9F7',fontSize:30,fontWeight:'900',letterSpacing:-1.1,textAlign:'center',marginTop:12},
  sub:{color:'#738A81',fontSize:11,lineHeight:17,textAlign:'center',marginTop:7,maxWidth:360},
  quickGrid:{width:'100%',flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:24},
  quick:{flexGrow:1,flexBasis:'46%',minHeight:82,borderWidth:1,borderColor:'#1E332D',borderRadius:15,backgroundColor:'#0C1815',alignItems:'center',justifyContent:'center',padding:8},
  quickDisabled:{opacity:.35},quickIcon:{color:'#29D196',fontSize:24,fontWeight:'400'},quickTitle:{color:'#C0D1CA',fontSize:12,fontWeight:'800',marginTop:8,textAlign:'center'},
  usageCard:{width:'100%',marginTop:12,borderWidth:1,borderColor:'#20332E',borderRadius:14,backgroundColor:'#0A1613',padding:12},
  libraryShortcut:{width:'100%',marginTop:8,borderWidth:1,borderColor:'#20332E',borderRadius:14,backgroundColor:'#0A1613',padding:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  usageLabel:{color:'#85D953',fontSize:10,fontWeight:'900',letterSpacing:1.25},usageValue:{color:'#8CA199',fontSize:12,lineHeight:18,marginTop:5},
  section:{width:'100%',color:'#698078',fontSize:10,fontWeight:'900',letterSpacing:1.4,marginTop:30,marginBottom:8},
  chatRow:{width:'100%',minHeight:58,borderBottomWidth:1,borderBottomColor:'#172722',flexDirection:'row',alignItems:'center',justifyContent:'space-between'},rowPressed:{backgroundColor:'#0E1D18'},chatTitle:{color:'#C6D6D0',fontSize:14,flex:1},chev:{color:'#557067',fontSize:22},empty:{color:'#6E837B',fontSize:12,textAlign:'center',marginTop:20},
  nav:{height:72,borderTopWidth:1,borderTopColor:'#1B2C27',backgroundColor:'#091310',flexDirection:'row',alignItems:'center',justifyContent:'space-around'},navItem:{alignItems:'center',flex:1,minHeight:52,justifyContent:'center'},navIcon:{color:'#536D63',fontSize:18},navLabel:{color:'#536D63',fontSize:10,fontWeight:'800',marginTop:3},navActive:{color:'#88E959'},
  chatTop:{minHeight:62,paddingHorizontal:10,borderBottomWidth:1,borderBottomColor:'#172722',flexDirection:'row',alignItems:'center',gap:7,backgroundColor:'#08120F'},back:{color:'#7E988E',fontSize:12},chatTitleWrap:{flex:1,minWidth:0},chatTopTitle:{color:'#DCE8E3',fontSize:14,fontWeight:'900'},chatMetaRow:{flexDirection:'row',alignItems:'center',gap:5,marginTop:3},providerPillText:{color:'#69CFA7',fontSize:8,fontWeight:'800'},providerPillDemo:{color:'#D3A162'},projectContext:{color:'#4F8F77',fontSize:7,fontWeight:'900',letterSpacing:1.2},tempContext:{color:'#62D8B0',fontSize:7,fontWeight:'900',letterSpacing:1.1},
  conversationActions:{minHeight:37,borderBottomWidth:1,borderBottomColor:'#172722',paddingHorizontal:10,paddingVertical:5,flexDirection:'row',gap:6,justifyContent:'flex-end',backgroundColor:'#08120F'},conversationAction:{height:27,borderWidth:1,borderColor:'#20362F',borderRadius:8,paddingHorizontal:9,alignItems:'center',justifyContent:'center',backgroundColor:'#0A1713'},conversationActionText:{color:'#78978B',fontSize:7,fontWeight:'800'},tempAction:{borderColor:'#285A49',backgroundColor:'#0B2119'},
  modelButton:{maxWidth:92,minHeight:36,borderWidth:1,borderColor:'#21372F',borderRadius:12,paddingHorizontal:9,flexDirection:'row',alignItems:'center',gap:4,backgroundColor:'#0B1814'},model:{color:'#9FB5AC',fontSize:10,fontWeight:'800',flexShrink:1},modelArrow:{color:'#60786F',fontSize:11},headerIconButton:{width:36,height:36,borderRadius:12,alignItems:'center',justifyContent:'center'},headerIcon:{color:'#A9BDB5',fontSize:27,lineHeight:29},moreGlyph:{color:'#8BA097',fontSize:13,fontWeight:'900',letterSpacing:1},
  thread:{flex:1},bubble:{maxWidth:'92%',paddingVertical:11,paddingHorizontal:13,borderRadius:18,flexDirection:'row',gap:9},messagePressed:{opacity:.78},userBubble:{alignSelf:'flex-end',backgroundColor:'#173B2C',borderWidth:1,borderColor:'#2A674C',marginVertical:3},aiBubble:{alignSelf:'stretch',maxWidth:'100%',backgroundColor:'transparent',borderWidth:0,paddingHorizontal:2,marginVertical:7},bubbleLogo:{width:22,height:22,resizeMode:'contain',marginTop:1},bubbleText:{color:'#D7E4DF',fontSize:15,lineHeight:22},
  richMessage:{gap:5,flex:1},mdText:{color:'#DCE8E3',fontSize:15,lineHeight:23},mdBold:{fontWeight:'900',color:'#F3F8F5'},mdItalic:{fontStyle:'italic',color:'#D4E0DB'},mdLink:{color:'#6EDBAE',textDecorationLine:'underline'},mdInlineCode:{fontFamily:Platform.select({ios:'Menlo',android:'monospace',default:'monospace'}),backgroundColor:'#14221E',color:'#BDE8D6',fontSize:13},mdH1:{fontSize:22,lineHeight:29,fontWeight:'900',color:'#F3F8F5',marginTop:6},mdH2:{fontSize:19,lineHeight:26,fontWeight:'900',color:'#EEF6F2',marginTop:5},mdH3:{fontSize:17,lineHeight:24,fontWeight:'800',color:'#E7F0EC',marginTop:4},mdSpacer:{height:5},mdQuote:{borderLeftWidth:3,borderLeftColor:'#2F7255',paddingLeft:11,paddingVertical:3,marginVertical:3},mdQuoteText:{color:'#9FB6AD',fontStyle:'italic'},mdListRow:{flexDirection:'row',alignItems:'flex-start',gap:8,paddingRight:4},mdBullet:{color:'#7CE0B5',fontSize:16,lineHeight:23,width:12},mdOrder:{color:'#7CE0B5',fontSize:14,lineHeight:23,width:24,fontWeight:'800'},mdListText:{flex:1},mdHr:{height:1,backgroundColor:'#20342E',marginVertical:8},mdTable:{color:'#C9D9D2',fontSize:12,lineHeight:20,fontFamily:Platform.select({ios:'Menlo',android:'monospace',default:'monospace'}),backgroundColor:'#0A1512',padding:8,borderRadius:8},
  codeBlock:{backgroundColor:'#050D0B',borderWidth:1,borderColor:'#1C332B',borderRadius:12,maxWidth:'100%',overflow:'hidden',marginVertical:4},codeHeader:{height:32,paddingHorizontal:10,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:'#172A24'},codeContent:{padding:12},codeLanguage:{color:'#68A68D',fontSize:9,fontWeight:'900',textTransform:'uppercase'},codeHint:{color:'#4F6B60',fontSize:8},codeText:{color:'#D5E5DE',fontSize:12,fontFamily:Platform.select({ios:'Menlo',android:'monospace',default:'monospace'}),lineHeight:19},
  stoppedBadge:{alignSelf:'flex-start',marginTop:8,color:'#D2A66D',fontSize:8,fontWeight:'900',letterSpacing:1.2,borderWidth:1,borderColor:'#594425',borderRadius:6,paddingHorizontal:6,paddingVertical:3},messageActions:{flexDirection:'row',gap:16,marginTop:10},messageActionText:{color:'#648779',fontSize:10,fontWeight:'800'},
  generatedImage:{width:'100%',aspectRatio:1,borderRadius:12,backgroundColor:'#07110F',marginTop:10},mobileAttachment:{marginTop:8,borderWidth:1,borderColor:'#284039',borderRadius:10,padding:8,flexDirection:'row',gap:8,alignItems:'center'},mobileAttachmentIcon:{color:'#29D196'},mobileAttachmentName:{color:'#AEC2BA',fontSize:9},mobileAttachmentMeta:{color:'#5F766D',fontSize:7,marginTop:2},
  sources:{marginTop:9,borderTopWidth:1,borderTopColor:'#20342E',paddingTop:7},sourcesTitle:{color:'#5D8174',fontSize:7,fontWeight:'900',letterSpacing:1.3},sourceRow:{minHeight:28,flexDirection:'row',alignItems:'center',gap:7},sourceNumber:{width:17,height:17,borderRadius:9,backgroundColor:'#163B2D',color:'#75D7AE',fontSize:8,textAlign:'center',lineHeight:17},sourceText:{color:'#7F9B91',fontSize:8,flex:1},
  mobileWelcome:{paddingTop:90,paddingHorizontal:25},liveStatus:{marginHorizontal:18,marginTop:8,marginBottom:14,flexDirection:'row',alignItems:'center',gap:8},liveStatusText:{color:'#7EA095',fontSize:11,fontWeight:'700'},retryCard:{margin:16,borderWidth:1,borderColor:'#5B3A2E',backgroundColor:'#211611',borderRadius:14,padding:13},retryCardTitle:{color:'#E0A17B',fontSize:12,fontWeight:'900'},retryCardText:{color:'#AA8874',fontSize:11,lineHeight:16,marginTop:4},
  pendingStrip:{maxHeight:58,paddingHorizontal:10,paddingVertical:7,borderTopWidth:1,borderTopColor:'#172722'},pendingChip:{height:40,maxWidth:230,borderWidth:1,borderColor:'#294039',borderRadius:12,backgroundColor:'#0B1714',paddingHorizontal:10,flexDirection:'row',alignItems:'center',gap:8},pendingName:{color:'#A6B9B1',fontSize:10,maxWidth:180},pendingRemove:{color:'#8EA198',fontSize:18},
  activeModeRow:{minHeight:38,paddingHorizontal:12,paddingVertical:6,borderTopWidth:1,borderTopColor:'#172722',flexDirection:'row',gap:7,alignItems:'center',backgroundColor:'#08120F'},modePill:{height:27,borderWidth:1,borderColor:'#2D614C',backgroundColor:'#0C231A',borderRadius:14,paddingHorizontal:9,flexDirection:'row',alignItems:'center',gap:8},recordingPill:{borderColor:'#74404A',backgroundColor:'#251418'},modePillText:{color:'#8EDDBA',fontSize:9,fontWeight:'800'},modePillClose:{color:'#759187',fontSize:15},
  composer:{paddingHorizontal:10,paddingTop:8,paddingBottom:10,borderTopWidth:1,borderTopColor:'#172722',backgroundColor:'#091310',flexDirection:'row',alignItems:'flex-end',gap:8},plusButton:{width:44,height:44,borderRadius:14,borderWidth:1,borderColor:'#253B34',backgroundColor:'#0C1815',alignItems:'center',justifyContent:'center'},plusGlyph:{color:'#9AB1A7',fontSize:24,fontWeight:'400'},messageInput:{flex:1,maxHeight:140,minHeight:44,borderWidth:1,borderColor:'#253B34',borderRadius:16,backgroundColor:'#0C1815',color:'#EEF5F2',paddingHorizontal:13,paddingVertical:11,fontSize:15,lineHeight:21},send:{width:44,height:44,borderRadius:14,backgroundColor:'#8FEA50',alignItems:'center',justifyContent:'center'},sendDisabled:{opacity:.32},sendText:{color:'#07110F',fontSize:24,fontWeight:'900'},stopSend:{backgroundColor:'#2A1A1D',borderWidth:1,borderColor:'#6E3B43'},stopGlyph:{color:'#E58C95',fontSize:14},
  manager:{padding:22,paddingBottom:110},managerEyebrow:{color:'#5ED59D',fontSize:8,fontWeight:'900',letterSpacing:1.7,marginTop:14},managerTitle:{color:'#F0F6F3',fontSize:29,fontWeight:'900',letterSpacing:-1,marginTop:6,textAlign:'left'},inlineComposer:{marginTop:22,flexDirection:'row',gap:8},managerInput:{flex:1,minHeight:46,borderWidth:1,borderColor:'#20342E',borderRadius:12,backgroundColor:'#0C1815',color:'#EAF4EF',paddingHorizontal:12,paddingVertical:10},multilineInput:{minHeight:72,textAlignVertical:'top'},instructionsInput:{minHeight:120,textAlignVertical:'top'},addButton:{width:46,height:46,borderRadius:12,backgroundColor:'#8FEA50',alignItems:'center',justifyContent:'center'},addButtonText:{color:'#07110F',fontSize:22,fontWeight:'900'},managerCard:{minHeight:72,borderWidth:1,borderColor:'#20332E',borderRadius:14,backgroundColor:'#0B1714',marginTop:9,padding:12,flexDirection:'row',gap:10,alignItems:'center'},managerCardTitle:{color:'#B9CBC4',fontSize:12,fontWeight:'800'},managerCardText:{color:'#627970',fontSize:9,lineHeight:13,marginTop:4},openButton:{height:31,borderWidth:1,borderColor:'#2B5143',borderRadius:9,paddingHorizontal:10,alignItems:'center',justifyContent:'center'},openButtonText:{color:'#7BD9B0',fontSize:8,fontWeight:'800'},
  detailHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},detailBadge:{color:'#75D7AE',fontSize:7,fontWeight:'900',letterSpacing:1.5,borderWidth:1,borderColor:'#285040',borderRadius:7,paddingHorizontal:7,paddingVertical:4},projectActionRow:{flexDirection:'row',gap:8,marginTop:12},projectAction:{flex:1,minHeight:60,borderWidth:1,borderColor:'#20372F',borderRadius:13,backgroundColor:'#0B1814',alignItems:'center',justifyContent:'center'},projectActionIcon:{color:'#5ED59D',fontSize:18},projectActionText:{color:'#819A90',fontSize:8,fontWeight:'800',marginTop:4},fileRow:{minHeight:58,borderBottomWidth:1,borderBottomColor:'#172722',flexDirection:'row',alignItems:'center',gap:10},fileIcon:{color:'#4ED7A0',fontSize:18},fileTitle:{color:'#ADBFBA',fontSize:10,fontWeight:'700'},fileMeta:{color:'#5B7168',fontSize:7,marginTop:3},
  memoryComposer:{marginTop:22,borderWidth:1,borderColor:'#20342E',borderRadius:14,backgroundColor:'#0C1815',padding:10},memoryInput:{minHeight:70,color:'#E1ECE7',fontSize:11,textAlignVertical:'top'},memorySave:{alignSelf:'flex-end',minHeight:32,borderRadius:9,backgroundColor:'#8FEA50',paddingHorizontal:13,alignItems:'center',justifyContent:'center'},memorySaveText:{color:'#07110F',fontSize:8,fontWeight:'900'},memoryCard:{borderWidth:1,borderColor:'#20332E',borderRadius:13,backgroundColor:'#0B1714',padding:12,marginTop:9},memoryDisabled:{opacity:.5},memoryHeader:{flexDirection:'row',justifyContent:'flex-end'},memoryState:{fontSize:6,fontWeight:'900',letterSpacing:1.1},memoryOn:{color:'#78D7AE'},memoryOff:{color:'#6B7772'},memoryText:{color:'#B8CAC3',fontSize:11,lineHeight:16},memoryActions:{flexDirection:'row',justifyContent:'flex-end',gap:16,marginTop:10},memoryAction:{color:'#6FCFA7',fontSize:8,fontWeight:'800'},danger:{color:'#D8818A'},
  libraryCard:{width:'100%',minHeight:82,borderWidth:1,borderColor:'#20332E',borderRadius:14,backgroundColor:'#0B1714',padding:10,marginTop:9,flexDirection:'row',gap:10,alignItems:'center'},libraryThumb:{width:58,height:58,borderRadius:10,backgroundColor:'#07110F'},libraryFileIcon:{width:58,height:58,borderRadius:10,borderWidth:1,borderColor:'#20352E',alignItems:'center',justifyContent:'center'},libraryActions:{flexDirection:'row',gap:15,marginTop:9,flexWrap:'wrap'},
  shareManagerCard:{width:'100%',minHeight:82,borderWidth:1,borderColor:'#20332E',borderRadius:14,backgroundColor:'#0B1714',padding:12,marginTop:9,flexDirection:'row',gap:10,alignItems:'center'},shareManagerInactive:{opacity:.55},shareManagerTitleRow:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:4},shareManagerStatus:{color:'#77D9AD',fontSize:6,fontWeight:'900',letterSpacing:1,borderWidth:1,borderColor:'#2C5B49',borderRadius:6,paddingHorizontal:5,paddingVertical:2},shareManagerStatusOff:{color:'#7B8B85',borderColor:'#34433E'},
  currentPlanMobile:{width:'100%',marginTop:20,borderWidth:1,borderColor:'#285244',borderRadius:14,backgroundColor:'#0C1B17',padding:13},currentPlanTitle:{color:'#DCE9E4',fontSize:18,fontWeight:'900',marginTop:5},planCardMobile:{width:'100%',minHeight:96,borderWidth:1,borderColor:'#20332E',borderRadius:14,backgroundColor:'#0B1714',padding:13,marginTop:9,flexDirection:'row',alignItems:'center',gap:10},planCardCurrent:{borderColor:'#2D6953'},planNameMobile:{color:'#C6D6D0',fontSize:15,fontWeight:'900',marginTop:3},planPriceMobile:{color:'#78D7AE',fontSize:10,fontWeight:'800',marginTop:4},planButtonDisabled:{opacity:.4},checkoutMobile:{width:'100%',marginTop:18,borderWidth:1,borderColor:'#2C5A49',borderRadius:14,backgroundColor:'#0C1D18',padding:13},checkoutDone:{color:'#78D7AE',fontSize:10,fontWeight:'900',marginTop:10},
  accountCard:{width:'100%',borderWidth:1,borderColor:'#20332E',borderRadius:14,backgroundColor:'#0B1714',padding:13,marginTop:12,gap:9},accountEmail:{color:'#607970',fontSize:9},deviceRow:{minHeight:50,borderTopWidth:1,borderTopColor:'#1A2B26',paddingVertical:9,flexDirection:'row',alignItems:'center',gap:10},deviceTitle:{color:'#AFC1BA',fontSize:9},deviceMeta:{color:'#60756D',fontSize:7,marginTop:3},secondaryMobile:{minHeight:37,borderWidth:1,borderColor:'#2A4039',borderRadius:10,alignItems:'center',justifyContent:'center',paddingHorizontal:10},secondaryMobileText:{color:'#91A79F',fontSize:9,fontWeight:'800'},deleteMobile:{minHeight:37,borderWidth:1,borderColor:'#573036',borderRadius:10,alignItems:'center',justifyContent:'center',paddingHorizontal:10},deleteMobileText:{color:'#D8818A',fontSize:9,fontWeight:'800'},modelPreference:{minHeight:52,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},warningText:{color:'#C39A5E',fontSize:8,lineHeight:13},
  modalBackdrop:{flex:1,backgroundColor:'rgba(0,0,0,.68)',justifyContent:'flex-end'},modelSheet:{backgroundColor:'#0A1512',borderTopWidth:1,borderTopColor:'#294139',borderTopLeftRadius:26,borderTopRightRadius:26,padding:18,paddingBottom:34},compactSheet:{backgroundColor:'#0A1512',borderTopWidth:1,borderTopColor:'#294139',borderTopLeftRadius:26,borderTopRightRadius:26,padding:18,paddingBottom:30},sheetHandle:{width:44,height:4,borderRadius:2,backgroundColor:'#294139',alignSelf:'center',marginBottom:14},sheetTitle:{color:'#EDF5F1',fontSize:20,fontWeight:'900'},sheetSub:{color:'#71867E',fontSize:11,lineHeight:16,marginTop:5,marginBottom:12},actionGrid:{flexDirection:'row',flexWrap:'wrap',gap:9,marginTop:8},actionTile:{width:'48%',minHeight:92,borderWidth:1,borderColor:'#20352E',borderRadius:15,backgroundColor:'#0C1815',padding:12,justifyContent:'center'},actionTileDisabled:{opacity:.45},actionTileIcon:{color:'#6FE0B2',fontSize:20},actionTileTitle:{color:'#D5E2DD',fontSize:13,fontWeight:'900',marginTop:8},actionTileMeta:{color:'#6D827A',fontSize:9,marginTop:3},sheetAction:{minHeight:64,borderTopWidth:1,borderTopColor:'#172722',flexDirection:'row',alignItems:'center',gap:12,paddingVertical:10},sheetActionIcon:{width:32,color:'#69D9AD',fontSize:19,textAlign:'center'},sheetActionTitle:{color:'#D6E3DE',fontSize:13,fontWeight:'900'},sheetActionMeta:{color:'#6C8179',fontSize:10,lineHeight:14,marginTop:3},modelRow:{minHeight:70,borderWidth:1,borderColor:'#20332E',borderRadius:14,padding:12,marginTop:8,flexDirection:'row',alignItems:'center',gap:10},modelRowActive:{borderColor:'#39765D',backgroundColor:'#0C2119'},modelRowLocked:{opacity:.52},modelRowTitle:{color:'#D2DFDA',fontSize:13,fontWeight:'900'},modelRowDescription:{color:'#71857E',fontSize:10,lineHeight:15,marginTop:3},modelRowTier:{color:'#75D7AE',fontSize:8,fontWeight:'900'},modelRowLockedText:{color:'#A98469',fontSize:8,fontWeight:'900'},
  previewBackdrop:{flex:1,backgroundColor:'rgba(2,8,6,.96)',paddingTop:Platform.OS === 'ios' ? 50 : 22},previewHeader:{height:50,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},previewTitle:{color:'#C9D8D2',fontSize:11,fontWeight:'800',flex:1,marginRight:12},previewClose:{color:'#ADC2B9',fontSize:28},previewImage:{flex:1,width:'100%'},
});
