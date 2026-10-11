const json = (res: Response) => res.json();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const data = await json(res);
  if (!res.ok) {
    throw new Error(data?.error?.message || '请求失败');
  }
  return data as T;
}

export const api = {
  login: (email: string, password: string) =>
    request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/api/v1/auth/logout', { method: 'POST' }),
  me: () => request<{ store: { name: string; company_address: string } }>('/api/v1/auth/me'),
  customers: (query = '') => request<{ items: Customer[]; total: number }>(`/api/v1/customers${query}`),
  customer: (id: string) => request<CustomerDetail>(`/api/v1/customers/${id}`),
  addNote: (id: string, text: string) =>
    request<{ privacyWarnings: string[] }>(`/api/v1/customers/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  preview: (body: object) => request<Preview>('/api/v1/audience/preview', { method: 'POST', body: JSON.stringify(body) }),
  createOutreach: (body: object) =>
    request<Outreach>('/api/v1/outreach', { method: 'POST', body: JSON.stringify(body) }),
  getOutreach: (id: string) => request<Outreach>(`/api/v1/outreach/${id}`),
  generate: (id: string) => request<Outreach>(`/api/v1/outreach/${id}/generate`, { method: 'POST' }),
  updateDraft: (id: string, body: string) =>
    request<Draft>(`/api/v1/drafts/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  reviewDraft: (id: string, decision: 'approve' | 'reject') =>
    request<Draft>(`/api/v1/drafts/${id}/review`, { method: 'POST', body: JSON.stringify({ decision }) }),
  bulkApprove: (id: string) =>
    request<{ approved: number; skipped: number } & Outreach>(`/api/v1/outreach/${id}/drafts/bulk-approve`, {
      method: 'POST',
    }),
  renderDraft: (id: string) => request<{ subject: string; body: string }>(`/api/v1/drafts/${id}/rendered`),
  send: (id: string) => request<{ sent: number; sender: string }>(`/api/v1/outreach/${id}/send`, { method: 'POST' }),
};

export type Customer = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  country: string;
  language: string;
  emailConsent: boolean;
  orderCount: number;
  totalSpentCents: number;
  lastOrderAt: string | null;
  spendTier: string;
  topCategory: string | null;
  hasNotes: boolean;
  daysSinceLastOrder: number | null;
};

export type CustomerDetail = Customer & {
  notes: { id: string; text: string }[];
  orders: { id: string; name: string; created_at_shop: string; total_cents: number }[];
};

export type Preview = {
  total: number;
  reachable: number;
  excluded: number;
  languages: { en: number; es: number };
  personalized: number;
  cohort: number;
};

export type Draft = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  country: string;
  language: string;
  mode: string;
  subject: string;
  body: string;
  zhSubject: string;
  zhBody: string;
  personalizationPoints: string[];
  status: string;
  issues: { level: string; message: string }[];
  canApprove: boolean;
};

export type Outreach = {
  id: string;
  name: string;
  intentZh: string;
  reachable: number;
  excluded: number;
  exclusionReasons: Record<string, number>;
  drafts: Draft[];
  status: string;
};
