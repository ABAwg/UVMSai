export type Session = {
  access: string;
  refresh: string;
  user: { id: string; display_name: string; email: string; role: string };
};

export type Chat = {
  id: string;
  title: string;
  model_id: string;
  is_archived?: boolean;
  is_pinned?: boolean;
  is_temporary?: boolean;
  expires_at?: string | null;
};

export type Citation = { url: string; title: string };

export type FileAsset = {
  id: string;
  original_name: string;
  mime_type: string;
  category: string;
  size_bytes: number;
  created_at?: string;
};

export type PickedFile = {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
};

export type MessageMeta = {
  web_search?: boolean;
  web_search_status?: string;
  citations?: Citation[];
  image_generation?: boolean;
  demo?: boolean;
  stopped?: boolean;
  request_id?: string;
};

export type Msg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: FileAsset[];
  meta?: MessageMeta;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  created_at?: string;
  updated_at?: string;
};

export type Memory = {
  id: string;
  content: string;
  is_enabled: boolean;
  source: string;
};

export type Usage = {
  plan: string;
  plan_name: string;
  today: { messages: number; web_searches: number };
  month?: { images: number };
};

export type Plan = {
  code: string;
  name: string;
  monthly_price_cents: number;
  currency: string;
  limits: Record<string, number>;
};

export type Subscription = {
  plan_code: string;
  plan_name: string;
  status: string;
  provider?: string | null;
};

export type Checkout = {
  id: string;
  plan_code: string;
  provider: string;
  status: string;
  amount_cents: number;
  currency: string;
};

export type DeviceSession = {
  id: string;
  user_agent?: string | null;
  ip_address?: string | null;
  created_at: string;
  revoked_at?: string | null;
};

export type ModelInfo = {
  id: string;
  name: string;
  description: string;
  tier: string;
  available: boolean;
};

export type Screen = 'home' | 'chat' | 'projects' | 'projectDetail' | 'memory' | 'library' | 'shares' | 'plans' | 'account';


export type SharedChatRecord = {
  id: string;
  source_chat_id?: string | null;
  title: string;
  created_at: string;
  expires_at?: string | null;
  revoked_at?: string | null;
};
